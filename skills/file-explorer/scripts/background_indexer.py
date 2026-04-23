#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
后台索引器

功能：
    - Daemon 线程：随主进程自动终止
    - 待索引队列：线程安全的文件队列
    - 批量保存：每 10 个文件保存一次，减少 I/O
    - 待索引持久化：pending_index.json 支持恢复
"""

import json
import os
import queue
import sys
import threading
import time
from datetime import datetime
from typing import Callable, List, Optional, Dict, Any

from file_index_sqlite import FileIndexSQLite as FileIndex
from file_lock import file_lock


class BackgroundIndexer:
    """
    后台索引管理器

    Attributes:
        file_index: FileIndex 实例
        lock_file: 文件锁路径
        pending_queue: 待索引文件队列
        worker_thread: Daemon 工作线程
        shutdown_event: 关闭信号
        pending_path: 待索引队列持久化路径
    """

    def __init__(
        self,
        file_index: FileIndex,
        lock_file: str,
        pending_path: Optional[str] = None,
        read_file_content_func: Optional[Callable] = None
    ):
        """
        初始化后台索引器

        @param file_index: FileIndex 实例
        @param lock_file: 文件锁路径
        @param pending_path: 待索引队列持久化路径（可选）
        @param read_file_content_func: 文件内容读取函数（可选，避免循环导入）
        """
        self.file_index = file_index
        self.lock_file = lock_file
        self._read_file_content = read_file_content_func
        self.pending_queue: queue.Queue[str] = queue.Queue()
        self.worker_thread: Optional[threading.Thread] = None
        self.shutdown_event = threading.Event()
        self.pending_path = pending_path or os.path.join(
            os.path.dirname(file_index.index_path),
            "pending_index.json"
        )
        self.search_id = None  # 当前搜索 ID（防重复）

    def start_background_indexing(
        self,
        files: List[str],
        start_from_index: int,
        search_id: Optional[str] = None
    ) -> None:
        """
        启动后台索引

        @param files: 文件列表
        @param start_from_index: 起始索引位置
        @param search_id: 搜索 ID（可选，用于防重复）
        """
        # 检查是否已有后台索引正在运行
        if self.worker_thread and self.worker_thread.is_alive():
            # 如果 search_id 相同，跳过（避免重复工作）
            if search_id and self.search_id == search_id:
                return
            # 否则等待当前线程结束（最多 2 秒）
            self.request_shutdown()

        # 设置搜索 ID
        self.search_id = search_id

        # 清空待索引队列
        while not self.pending_queue.empty():
            try:
                self.pending_queue.get_nowait()
            except queue.Empty:
                break

        # 入队待索引文件
        pending_files = files[start_from_index:]
        for filepath in pending_files:
            self.pending_queue.put(filepath)

        # 保存待索引队列（用于恢复）
        self._save_pending_queue(pending_files, search_id)

        # 启动 Daemon 线程
        self.shutdown_event.clear()
        self.worker_thread = threading.Thread(
            target=self._indexing_worker,
            daemon=True  # Daemon 线程，随主进程自动终止
        )
        self.worker_thread.start()

        # 输出后台索引启动信息（stderr，不影响结果输出）
        print(
            f"[后台索引] 启动，待索引 {len(pending_files)} 个文件",
            file=sys.stderr
        )

    def _indexing_worker(self) -> None:
        """
        工作线程：解析文件，更新索引，批量保存
        """
        indexed_count = 0
        batch_size = 10

        while not self.shutdown_event.is_set():
            try:
                # 从队列获取文件（非阻塞，超时 0.1 秒）
                filepath = self.pending_queue.get(timeout=0.1)
            except queue.Empty:
                # 队列空，保存待索引队列（标记完成）
                self._clear_pending_queue()
                # 最终保存
                try:
                    with file_lock(self.lock_file, timeout=5.0):
                        self.file_index.save()
                    print(
                        f"[后台索引] 完成，共索引 {indexed_count} 个文件",
                        file=sys.stderr
                    )
                except TimeoutError:
                    print(
                        f"[后台索引] 最终保存超时，跳过",
                        file=sys.stderr
                    )
                break

            # 解析文件内容
            if not self._read_file_content:
                print("[后台索引] 无文件读取函数，跳过", file=sys.stderr)
                continue

            try:
                result = self._read_file_content(filepath)
            except Exception as e:
                # 文件解析失败，跳过
                print(
                    f"[后台索引] 文件解析失败: {filepath} - {e}",
                    file=sys.stderr
                )
                continue

            # read_file_content 返回 dict，检查错误
            if result.get("error") is not None:
                print(
                    f"[后台索引] 文件解析失败: {filepath} - {result['error']}",
                    file=sys.stderr
                )
                continue

            content = result["content"]

            # 更新索引（加锁）
            try:
                with file_lock(self.lock_file, timeout=10.0):
                    self.file_index.update_file(filepath, content)
                    indexed_count += 1

                    # 批量保存（每 10 个文件）
                    if indexed_count % batch_size == 0:
                        self.file_index.save()
                        print(
                            f"[后台索引] 已索引 {indexed_count} 个文件",
                            file=sys.stderr
                        )
            except TimeoutError:
                # 锁超时，跳过本次更新
                print(
                    f"[后台索引] 锁超时，跳过: {filepath}",
                    file=sys.stderr
                )
                continue
            except Exception as e:
                # 其他错误，跳过
                print(
                    f"[后台索引] 更新失败: {filepath} - {e}",
                    file=sys.stderr
                )
                continue

    def request_shutdown(self) -> None:
        """
        请求关闭后台索引线程（最多等待 2 秒）
        """
        if not self.worker_thread or not self.worker_thread.is_alive():
            return

        # 发送关闭信号
        self.shutdown_event.set()

        # 等待线程结束（最多 2 秒）
        self.worker_thread.join(timeout=2.0)

        if self.worker_thread.is_alive():
            print(
                "[后台索引] 线程未在 2 秒内终止，强制继续",
                file=sys.stderr
            )

    def _save_pending_queue(
        self,
        pending_files: List[str],
        search_id: Optional[str]
    ) -> None:
        """
        保存待索引队列（用于恢复）

        @param pending_files: 待索引文件列表
        @param search_id: 搜索 ID
        """
        pending_data = {
            "pending_files": pending_files,
            "search_id": search_id,
            "timestamp": datetime.now().isoformat()
        }

        try:
            os.makedirs(os.path.dirname(self.pending_path), exist_ok=True)
            with open(self.pending_path, 'w', encoding='utf-8') as f:
                json.dump(pending_data, f, ensure_ascii=False, indent=2)
        except (IOError, OSError) as e:
            print(
                f"[后台索引] 保存待索引队列失败: {e}",
                file=sys.stderr
            )

    def _clear_pending_queue(self) -> None:
        """
        清除待索引队列文件（标记完成）
        """
        if os.path.exists(self.pending_path):
            try:
                os.remove(self.pending_path)
            except OSError as e:
                print(
                    f"[后台索引] 清除待索引队列失败: {e}",
                    file=sys.stderr
                )

    def has_pending_queue(self) -> bool:
        """
        检查是否存在待索引队列文件

        @returns 是否存在待索引队列
        """
        return os.path.exists(self.pending_path)

    def load_pending_queue(self) -> Optional[Dict[str, Any]]:
        """
        加载待索引队列（用于恢复）

        @returns 待索引队列数据或 None
        """
        if not os.path.exists(self.pending_path):
            return None

        try:
            with open(self.pending_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError, OSError) as e:
            print(
                f"[后台索引] 加载待索引队列失败: {e}",
                file=sys.stderr
            )
            # 清除损坏的文件
            try:
                os.remove(self.pending_path)
            except OSError:
                pass
            return None
