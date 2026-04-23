#!/usr/bin/env python3
"""Tests for background_indexer module"""

import os
import tempfile
import time
import unittest

from file_index_sqlite import FileIndexSQLite as FileIndex
from background_indexer import BackgroundIndexer


class TestBackgroundIndexer(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.index_path = os.path.join(self.tmpdir, "test_index.json")
        self.lock_file = os.path.join(self.tmpdir, ".lock")
        self.pending_path = os.path.join(self.tmpdir, "pending_index.json")

    def tearDown(self):
        for f in [self.index_path, self.lock_file, self.pending_path,
                  self.index_path + '.tmp']:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except OSError:
                    pass
        try:
            os.rmdir(self.tmpdir)
        except OSError:
            pass

    def _make_read_func(self, content="test content"):
        """Create a mock read_file_content function"""
        def read_func(filepath):
            return {
                "filepath": filepath,
                "content": content,
                "size_chars": len(content),
                "error": None
            }
        return read_func

    def test_init(self):
        """BackgroundIndexer initializes correctly"""
        file_index = FileIndex(self.index_path, self.lock_file)
        indexer = BackgroundIndexer(
            file_index,
            self.lock_file,
            self.pending_path,
            read_file_content_func=self._make_read_func()
        )
        self.assertIsNone(indexer.worker_thread)
        self.assertFalse(indexer.has_pending_queue())

    def test_start_and_shutdown(self):
        """Start background indexing and request shutdown"""
        file_index = FileIndex(self.index_path, self.lock_file)
        indexer = BackgroundIndexer(
            file_index,
            self.lock_file,
            self.pending_path,
            read_file_content_func=self._make_read_func()
        )

        # Start with empty file list
        indexer.start_background_indexing([], start_from_index=0)

        # Give thread time to finish
        time.sleep(0.5)

        # Shutdown should be safe even after thread finishes
        indexer.request_shutdown()
        self.assertFalse(indexer.worker_thread.is_alive())

    def test_pending_queue_persistence(self):
        """Pending queue is saved and can be loaded"""
        file_index = FileIndex(self.index_path, self.lock_file)
        indexer = BackgroundIndexer(
            file_index,
            self.lock_file,
            self.pending_path,
            read_file_content_func=self._make_read_func()
        )

        # Start indexing with files
        indexer.start_background_indexing(
            ["/fake/file1.pdf", "/fake/file2.pdf"],
            start_from_index=0,
            search_id="test-1"
        )

        # Pending queue should exist
        time.sleep(0.1)
        self.assertTrue(indexer.has_pending_queue())

        # Load pending queue
        pending = indexer.load_pending_queue()
        self.assertIsNotNone(pending)
        self.assertEqual(pending["search_id"], "test-1")

        # Shutdown
        indexer.request_shutdown()

    def test_no_read_func_skips(self):
        """Worker skips files when no read_func provided"""
        file_index = FileIndex(self.index_path, self.lock_file)
        indexer = BackgroundIndexer(
            file_index,
            self.lock_file,
            self.pending_path
        )

        # Start with files but no read_func
        indexer.start_background_indexing(
            ["/fake/file1.pdf"],
            start_from_index=0
        )

        time.sleep(0.5)
        indexer.request_shutdown()


if __name__ == "__main__":
    unittest.main()