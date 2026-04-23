#!/usr/bin/env python3
"""
FileIndexSQLite 单元测试

测试契约：FileIndexSQLite 必须与 FileIndex 保持相同的公共 API 和行为
"""

import os
import tempfile
import unittest
import time

from file_index_sqlite import FileIndexSQLite


class TestFileIndexSQLite(unittest.TestCase):
    """FileIndexSQLite 契约测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.index_path = os.path.join(self.tmpdir, "test_index.db")

    def tearDown(self):
        if os.path.exists(self.index_path):
            try:
                os.remove(self.index_path)
            except OSError:
                pass
        try:
            os.rmdir(self.tmpdir)
        except OSError:
            pass

    def test_init_creates_db(self):
        """初始化时创建数据库文件"""
        index = FileIndexSQLite(self.index_path)
        self.assertTrue(os.path.exists(self.index_path))
        status = index.get_status()
        self.assertEqual(status["total_files"], 0)

    def test_update_and_get_cache(self):
        """更新文件索引并获取缓存"""
        index = FileIndexSQLite(self.index_path)

        # 创建测试文件
        test_file = os.path.join(self.tmpdir, "test.txt")
        with open(test_file, 'w') as f:
            f.write("test content")

        # 更新索引
        index.update_file(test_file, "test content")

        # 获取缓存
        cached = index.get_file_cache(test_file)
        self.assertIsNotNone(cached)
        self.assertEqual(cached["content"], "test content")
        self.assertEqual(cached["filename"], "test.txt")

    def test_cache_invalidation_on_mtime_change(self):
        """文件修改后缓存失效"""
        index = FileIndexSQLite(self.index_path)

        test_file = os.path.join(self.tmpdir, "test.txt")
        with open(test_file, 'w') as f:
            f.write("original")

        index.update_file(test_file, "original")

        # 修改文件
        time.sleep(0.1)  # 确保 mtime 变化
        with open(test_file, 'w') as f:
            f.write("modified")

        # 缓存应失效
        cached = index.get_file_cache(test_file)
        self.assertIsNone(cached)

    def test_search_filename(self):
        """文件名搜索"""
        index = FileIndexSQLite(self.index_path)

        # 创建多个文件
        files = []
        for name in ["resume.pdf", "report.docx", "data.xlsx"]:
            filepath = os.path.join(self.tmpdir, name)
            with open(filepath, 'w') as f:
                f.write("content")
            index.update_file(filepath, "content")
            files.append(filepath)

        # 搜索包含 "resume" 的文件
        results = index.search_filename("resume")
        self.assertEqual(len(results), 1)
        self.assertIn("resume.pdf", results[0]["filepath"])

    def test_search_content(self):
        """内容搜索"""
        index = FileIndexSQLite(self.index_path)

        # 创建文件
        test_file = os.path.join(self.tmpdir, "test.txt")
        with open(test_file, 'w') as f:
            f.write("hello world")

        index.update_file(test_file, "hello world")

        # 搜索内容
        results = index.search_content("world")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["filepath"], test_file)
        self.assertEqual(results[0]["match_count"], 1)

    def test_search_content_limited_files(self):
        """限定文件范围的内容搜索"""
        index = FileIndexSQLite(self.index_path)

        # 创建多个文件
        file1 = os.path.join(self.tmpdir, "file1.txt")
        file2 = os.path.join(self.tmpdir, "file2.txt")

        with open(file1, 'w') as f:
            f.write("apple")
        with open(file2, 'w') as f:
            f.write("banana")

        index.update_file(file1, "apple")
        index.update_file(file2, "banana")

        # 只在 file1 中搜索
        results = index.search_content("apple", filepaths=[file1])
        self.assertEqual(len(results), 1)

        # 在 file2 中搜索 apple（不应找到）
        results = index.search_content("apple", filepaths=[file2])
        self.assertEqual(len(results), 0)

    def test_get_status(self):
        """获取索引状态"""
        index = FileIndexSQLite(self.index_path)

        test_file = os.path.join(self.tmpdir, "test.txt")
        with open(test_file, 'w') as f:
            f.write("x" * 100)

        index.update_file(test_file, "x" * 100)

        status = index.get_status()
        self.assertEqual(status["total_files"], 1)
        self.assertGreater(status["total_size"], 0)
        self.assertIsNotNone(status["last_updated"])

    def test_clear(self):
        """清空索引"""
        index = FileIndexSQLite(self.index_path)

        test_file = os.path.join(self.tmpdir, "test.txt")
        with open(test_file, 'w') as f:
            f.write("content")

        index.update_file(test_file, "content")

        # 清空
        index.clear()

        status = index.get_status()
        self.assertEqual(status["total_files"], 0)

    def test_concurrent_updates(self):
        """并发更新安全性"""
        import threading

        index = FileIndexSQLite(self.index_path)

        # 创建多个线程同时更新
        threads = []
        for i in range(10):
            test_file = os.path.join(self.tmpdir, f"file{i}.txt")
            with open(test_file, 'w') as f:
                f.write(f"content{i}")

            t = threading.Thread(
                target=lambda f=test_file, c=f"content{i}": index.update_file(f, c)
            )
            threads.append(t)

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 验证所有文件都已索引
        status = index.get_status()
        self.assertEqual(status["total_files"], 10)

    def test_metadata_accuracy(self):
        """元数据准确性"""
        index = FileIndexSQLite(self.index_path)

        files = []
        for i in range(5):
            test_file = os.path.join(self.tmpdir, f"file{i}.txt")
            content = "x" * (i + 1) * 100  # 不同大小
            with open(test_file, 'w') as f:
                f.write(content)
            index.update_file(test_file, content)
            files.append(test_file)

        status = index.get_status()
        self.assertEqual(status["total_files"], 5)
        # 验证总大小是各文件大小之和
        expected_total_size = sum(os.path.getsize(f) for f in files)
        self.assertEqual(status["total_size"], expected_total_size)


if __name__ == "__main__":
    unittest.main()
