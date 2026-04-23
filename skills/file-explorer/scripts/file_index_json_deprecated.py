#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件索引引擎

功能：
    - 文件名索引：快速匹配文件名（good case: 简历场景）
    - 内容索引：缓存文件全文，避免重复解析
    - 增量更新：基于 mtime 检测变化
"""

import json
import os
import re
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any


class FileIndex:
    """
    文件索引管理器（线程安全）

    Attributes:
        index_path: 索引文件路径
        lock_file: 文件锁路径（跨进程）
        index: 索引数据结构
        _lock: 线程锁（进程内）
    """

    def __init__(self, index_path: str, lock_file: Optional[str] = None):
        """
        初始化索引管理器

        @param index_path: 索引文件路径
        @param lock_file: 文件锁路径（可选）
        """
        self.index_path = index_path
        self.lock_file = lock_file
        self._lock = threading.RLock()  # 可重入锁
        self.index = self._load_index()

    def _load_index(self) -> Dict[str, Any]:
        """
        加载索引文件,不存在则返回空结构

        @returns 索引数据结构
        """
        if os.path.exists(self.index_path):
            try:
                with open(self.index_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                # 索引损坏时返回空结构
                pass

        return {
            "files": {},           # filepath -> {filename, mtime, size, content, last_indexed}
            "filename_index": [],  # [{name, path}] 列表，用于文件名快速匹配
            "metadata": {
                "total_files": 0,
                "total_size": 0,
                "last_updated": None
            }
        }

    def save(self) -> None:
        """
        保存索引到文件（原子写入）

        使用临时文件 + os.rename 确保原子性，
        防止进程崩溃时损坏索引。
        """
        with self._lock:
            self.index["metadata"]["last_updated"] = datetime.now().isoformat()

            # 确保目录存在
            index_dir = os.path.dirname(self.index_path)
            os.makedirs(index_dir, exist_ok=True)

            # 原子写入：先写临时文件，再 rename
            temp_path = self.index_path + '.tmp'
            try:
                with open(temp_path, 'w', encoding='utf-8') as f:
                    json.dump(self.index, f, ensure_ascii=False, indent=2)

                # 原子 rename（POSIX 保证原子性）
                os.replace(temp_path, self.index_path)
            except (IOError, OSError) as e:
                # 清理临时文件
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass
                raise e

    def get_file_cache(self, filepath: str) -> Optional[Dict[str, Any]]:
        """
        获取文件缓存内容（线程安全）

        @param filepath: 文件绝对路径
        @returns 缓存数据或 None (未缓存/已过期)
        """
        with self._lock:
            filepath = os.path.abspath(filepath)

            if filepath not in self.index["files"]:
                return None

            cached = self.index["files"][filepath]

            # 检查 mtime 是否变化
            try:
                current_mtime = os.path.getmtime(filepath)
                current_size = os.path.getsize(filepath)

                if cached["mtime"] == current_mtime and cached["size"] == current_size:
                    return cached
            except OSError:
                # 文件不存在或无法访问
                return None

            return None

    def update_file(self, filepath: str, content: str) -> None:
        """
        更新单个文件的索引（线程安全）

        @param filepath: 文件绝对路径
        @param content: 文件全文内容
        """
        with self._lock:
            filepath = os.path.abspath(filepath)

            try:
                mtime = os.path.getmtime(filepath)
                size = os.path.getsize(filepath)
            except OSError:
                return

            filename = os.path.basename(filepath)
            name_without_ext = os.path.splitext(filename)[0]

            # 更新文件索引
            self.index["files"][filepath] = {
                "filename": filename,
                "mtime": mtime,
                "size": size,
                "content": content,
                "last_indexed": datetime.now().isoformat()
            }

            # 更新文件名索引（去重）
            filename_index = self.index["filename_index"]
            # 移除旧条目
            filename_index[:] = [item for item in filename_index if item["path"] != filepath]
            # 添加新条目
            filename_index.append({
                "name": name_without_ext,
                "path": filepath
            })

            # 更新元数据
            self._update_metadata()

    def _update_metadata(self) -> None:
        """
        更新元数据统计
        """
        files = self.index["files"]
        self.index["metadata"]["total_files"] = len(files)
        self.index["metadata"]["total_size"] = sum(
            f.get("size", 0) for f in files.values()
        )

    def search_filename(self, pattern: str) -> List[Dict[str, Any]]:
        """
        在文件名中搜索匹配（good case 快速路径，线程安全）

        @param pattern: 正则表达式模式
        @returns 匹配结果列表 [{filepath, filename, match_type: "filename"}]
        """
        with self._lock:
            return self._search_filename_unlocked(pattern)

    def _search_filename_unlocked(self, pattern: str) -> List[Dict[str, Any]]:
        results = []
        try:
            regex = re.compile(pattern)
        except re.error:
            return results

        for item in self.index["filename_index"]:
            name = item["name"]
            if regex.search(name):
                filepath = item["path"]
                # 验证文件仍存在
                if os.path.exists(filepath):
                    results.append({
                        "filepath": filepath,
                        "filename": os.path.basename(filepath),
                        "match_type": "filename",
                        "match_count": 1
                    })

        return results

    def search_content(self, pattern: str, filepaths: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """
        在文件内容中搜索匹配（线程安全）

        @param pattern: 正则表达式模式
        @param filepaths: 限制搜索的文件列表，None 表示搜索所有已索引文件
        @returns 匹配结果列表 [{filepath, matches, match_count, match_type: "content"}]
        """
        with self._lock:
            return self._search_content_unlocked(pattern, filepaths)

    def _search_content_unlocked(self, pattern: str, filepaths: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        results = []
        try:
            regex = re.compile(pattern)
        except re.error:
            return results

        files_to_search = filepaths if filepaths else list(self.index["files"].keys())

        for filepath in files_to_search:
            if filepath not in self.index["files"]:
                continue

            cached = self.index["files"][filepath]
            content = cached.get("content", "")

            if not content:
                continue

            matches = regex.findall(content)
            if matches:
                results.append({
                    "filepath": filepath,
                    "matches": matches[:10],  # 预览：最多10个匹配
                    "match_count": len(matches),
                    "match_type": "content"
                })

        return results

    def get_status(self) -> Dict[str, Any]:
        """
        获取索引状态（线程安全）

        @returns 状态信息
        """
        with self._lock:
            metadata = self.index["metadata"]
        return {
            "index_file": self.index_path,
            "total_files": metadata["total_files"],
            "total_size": metadata["total_size"],
            "total_size_mb": round(metadata["total_size"] / 1024 / 1024, 2),
            "last_updated": metadata["last_updated"],
            "exists": os.path.exists(self.index_path)
        }

    def clear(self) -> None:
        """
        清空索引（线程安全）
        """
        with self._lock:
            self.index = {
                "files": {},
                "filename_index": [],
                "metadata": {
                    "total_files": 0,
                    "total_size": 0,
                    "last_updated": None
                }
            }
            self.save()
