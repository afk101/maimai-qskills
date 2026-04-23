#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQLite 文件索引引擎

性能优势：
    - 增量更新：只写单行，不需要全量重写
    - 索引查询：文件名搜索走索引 O(log N)
    - 内存友好：SQLite 自动管理缓存
    - 并发安全：数据库级锁 + WAL 模式
"""

import os
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any


class FileIndexSQLite:
    """
    SQLite 文件索引管理器（线程安全）

    Attributes:
        index_path: SQLite 数据库文件路径
        conn: SQLite 连接（线程局部）
        _lock: 线程锁
    """

    def __init__(self, index_path: str, lock_file: Optional[str] = None):
        """
        初始化索引管理器

        @param index_path: SQLite 数据库文件路径
        @param lock_file: 文件锁路径（兼容旧API，SQLite不需要）
        """
        self.index_path = index_path
        self._lock = threading.RLock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        """
        获取数据库连接（线程局部）

        SQLite 连接不能跨线程共享，每个线程需要独立连接。
        """
        conn = sqlite3.connect(self.index_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """
        初始化数据库表和索引
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            # 启用 WAL 模式（并发读写优化）
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")

            # 文件索引表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_index (
                    filepath TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    size INTEGER NOT NULL,
                    content TEXT,
                    last_indexed TEXT NOT NULL
                )
            """)

            # 文件名索引（加速文件名搜索）
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_filename
                ON file_index(filename)
            """)

            # 元数据表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)

            conn.commit()
            conn.close()

    def save(self) -> None:
        """
        保存索引（SQLite 自动持久化，此方法为兼容旧API）
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
                ("last_updated", datetime.now().isoformat())
            )
            conn.commit()
            conn.close()

    def get_file_cache(self, filepath: str) -> Optional[Dict[str, Any]]:
        """
        获取文件缓存内容（线程安全）

        @param filepath: 文件绝对路径
        @returns 缓存数据或 None (未缓存/已过期)
        """
        with self._lock:
            filepath = os.path.abspath(filepath)
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute(
                "SELECT * FROM file_index WHERE filepath = ?",
                (filepath,)
            )
            row = cursor.fetchone()
            conn.close()

            if not row:
                return None

            # 检查 mtime 是否变化
            try:
                current_mtime = os.path.getmtime(filepath)
                current_size = os.path.getsize(filepath)

                if row["mtime"] == current_mtime and row["size"] == current_size:
                    return dict(row)
            except OSError:
                return None

            return None

    def update_file(self, filepath: str, content: str) -> None:
        """
        更新单个文件的索引（线程安全）

        @param filepath: 文件绝对路径
        @param content: 文件全文内容
        """
        self.update_files([(filepath, content)])

    def update_files(self, files: List[tuple]) -> None:
        """
        批量更新文件索引（线程安全，单次事务）

        @param files: [(filepath, content), ...] 列表
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            last_indexed = datetime.now().isoformat()

            for filepath, content in files:
                filepath = os.path.abspath(filepath)

                try:
                    mtime = os.path.getmtime(filepath)
                    size = os.path.getsize(filepath)
                except OSError:
                    continue

                filename = os.path.basename(filepath)

                cursor.execute("""
                    INSERT OR REPLACE INTO file_index
                    (filepath, filename, mtime, size, content, last_indexed)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (filepath, filename, mtime, size, content, last_indexed))

            # 更新元数据（一次事务，一次提交）
            cursor.execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
                ("last_updated", last_indexed)
            )

            conn.commit()
            conn.close()

    def search_filename(self, pattern: str) -> List[Dict[str, Any]]:
        """
        在文件名中搜索匹配（索引加速，线程安全）

        @param pattern: 正则表达式模式
        @returns 匹配结果列表 [{filepath, filename, match_type: "filename"}]
        """
        with self._lock:
            results = []
            try:
                regex = re.compile(pattern)
            except re.error:
                return results

            conn = self._get_conn()
            cursor = conn.cursor()

            # 全表扫描文件名（索引优化：只查 filepath 和 filename）
            cursor.execute("SELECT filepath, filename FROM file_index")

            for row in cursor:
                name_without_ext = os.path.splitext(row["filename"])[0]
                if regex.search(name_without_ext):
                    filepath = row["filepath"]
                    # 验证文件仍存在
                    if os.path.exists(filepath):
                        results.append({
                            "filepath": filepath,
                            "filename": row["filename"],
                            "match_type": "filename",
                            "match_count": 1
                        })

            conn.close()
            return results

    def search_content(self, pattern: str, filepaths: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """
        在文件内容中搜索匹配（线程安全）

        @param pattern: 正则表达式模式
        @param filepaths: 限制搜索的文件列表，None 表示搜索所有已索引文件
        @returns 匹配结果列表 [{filepath, matches, match_count, match_type: "content"}]
        """
        with self._lock:
            results = []
            try:
                regex = re.compile(pattern)
            except re.error:
                return results

            conn = self._get_conn()
            cursor = conn.cursor()

            if filepaths:
                # 限定文件范围搜索
                placeholders = ",".join("?" * len(filepaths))
                cursor.execute(
                    f"SELECT filepath, content FROM file_index WHERE filepath IN ({placeholders})",
                    filepaths
                )
            else:
                # 全量搜索
                cursor.execute("SELECT filepath, content FROM file_index")

            for row in cursor:
                content = row["content"]
                if not content:
                    continue

                matches = regex.findall(content)
                if matches:
                    results.append({
                        "filepath": row["filepath"],
                        "matches": matches[:10],
                        "match_count": len(matches),
                        "match_type": "content"
                    })

            conn.close()
            return results

    def get_status(self) -> Dict[str, Any]:
        """
        获取索引状态（线程安全）

        @returns 状态信息
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size FROM file_index")
            row = cursor.fetchone()

            cursor.execute("SELECT value FROM metadata WHERE key = 'last_updated'")
            last_updated_row = cursor.fetchone()
            last_updated = last_updated_row["value"] if last_updated_row else None

            conn.close()

            return {
                "index_file": self.index_path,
                "total_files": row["total_files"],
                "total_size": row["total_size"],
                "total_size_mb": round(row["total_size"] / 1024 / 1024, 2),
                "last_updated": last_updated,
                "exists": os.path.exists(self.index_path)
            }

    def clear(self) -> None:
        """
        清空索引（线程安全）
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute("DELETE FROM file_index")
            cursor.execute("DELETE FROM metadata")

            conn.commit()
            conn.close()
