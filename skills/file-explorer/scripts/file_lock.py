#!/usr/bin/env python3
"""
File Locking Module

POSIX advisory lock implementation to prevent concurrent index corruption.
Uses fcntl.flock for cross-process synchronization.
"""

import fcntl
import os
import time
from contextlib import contextmanager
from typing import Generator


@contextmanager
def file_lock(lock_path: str, timeout: float = 10.0) -> Generator[None, None, None]:
    """
    Acquire exclusive file lock with timeout.

    Args:
        lock_path: Path to lock file
        timeout: Maximum seconds to wait for lock acquisition

    Yields:
        None when lock acquired

    Raises:
        TimeoutError: If lock not acquired within timeout
    """
    # Ensure lock directory exists
    lock_dir = os.path.dirname(lock_path)
    if lock_dir and not os.path.exists(lock_dir):
        os.makedirs(lock_dir, mode=0o700)

    # Create lock file if not exists with secure permissions
    if not os.path.exists(lock_path):
        fd = os.open(lock_path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)

    lock_file = None
    start_time = time.time()
    retry_interval = 0.05  # 50ms

    try:
        # Open for read+write (no truncation); create if missing
        try:
            lock_file = open(lock_path, 'r+')
        except FileNotFoundError:
            lock_file = open(lock_path, 'w+')

        # Retry loop with timeout
        while True:
            try:
                # Non-blocking exclusive lock
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                # Lock acquired successfully
                yield None
                return
            except (IOError, OSError):
                # Lock not available, check timeout
                elapsed = time.time() - start_time
                if elapsed >= timeout:
                    raise TimeoutError(
                        f"Could not acquire lock on {lock_path} within {timeout}s"
                    )
                # Wait before retry
                time.sleep(retry_interval)
    finally:
        if lock_file:
            try:
                # Release lock
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
            except (IOError, OSError):
                # Lock already released or file closed
                pass


def try_file_lock(lock_path: str) -> bool:
    """
    Try to acquire lock without waiting.

    Args:
        lock_path: Path to lock file

    Returns:
        True if lock acquired, False otherwise
    """
    try:
        with file_lock(lock_path, timeout=0.0):
            return True
    except TimeoutError:
        return False
