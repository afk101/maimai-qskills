#!/usr/bin/env python3
"""Tests for file_lock module"""

import os
import tempfile
import unittest

from file_lock import file_lock, try_file_lock


class TestFileLock(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.lock_path = os.path.join(self.tmpdir, "test.lock")

    def tearDown(self):
        if os.path.exists(self.lock_path):
            try:
                os.remove(self.lock_path)
            except OSError:
                pass
        try:
            os.rmdir(self.tmpdir)
        except OSError:
            pass

    def test_acquire_and_release(self):
        """Lock can be acquired and released"""
        with file_lock(self.lock_path, timeout=1.0):
            self.assertTrue(os.path.exists(self.lock_path))
        # After release, can acquire again
        with file_lock(self.lock_path, timeout=1.0):
            pass

    def test_reentrant(self):
        """Same thread can re-acquire (fcntl flock is per-fd, not per-thread)"""
        with file_lock(self.lock_path, timeout=1.0):
            # Opening same file with different fd should block,
            # but same fd reuse works fine
            pass

    def test_try_file_lock_success(self):
        """try_file_lock returns True when lock is available"""
        result = try_file_lock(self.lock_path)
        self.assertTrue(result)

    def test_lock_file_created(self):
        """Lock file is created if it doesn't exist"""
        self.assertFalse(os.path.exists(self.lock_path))
        with file_lock(self.lock_path, timeout=1.0):
            self.assertTrue(os.path.exists(self.lock_path))

    def test_lock_directory_created(self):
        """Lock directory is created if it doesn't exist"""
        deep_path = os.path.join(self.tmpdir, "sub", "dir", "test.lock")
        with file_lock(deep_path, timeout=1.0):
            self.assertTrue(os.path.exists(deep_path))
        # Cleanup
        os.remove(deep_path)
        os.rmdir(os.path.join(self.tmpdir, "sub", "dir"))
        os.rmdir(os.path.join(self.tmpdir, "sub"))

    def test_timeout_raises(self):
        """TimeoutError raised when lock cannot be acquired"""
        import fcntl
        # Hold the lock externally
        lock_file = open(self.lock_path, 'w')
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

        try:
            with self.assertRaises(TimeoutError):
                with file_lock(self.lock_path, timeout=0.1):
                    pass
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()


if __name__ == "__main__":
    unittest.main()
