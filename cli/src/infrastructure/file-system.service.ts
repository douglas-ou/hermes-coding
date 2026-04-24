import * as fs from 'fs-extra';
import * as nodeFs from 'fs';
import { IFileSystem, WriteFileOptions } from './file-system';
import { withRetry } from '../core/retry';

/**
 * FileSystemService implements IFileSystem interface with retry logic
 *
 * All file system operations are wrapped with retry logic to handle
 * transient errors like EBUSY, ENOENT, and EAGAIN. This provides
 * resilience against temporary file system issues.
 *
 * @example
 * ```typescript
 * const fileSystem = new FileSystemService();
 * const content = await fileSystem.readFile('/path/to/file.txt');
 * await fileSystem.writeFile('/path/to/output.txt', content);
 * ```
 */
export class FileSystemService implements IFileSystem {
  /**
   * Read file content with retry logic
   * @param path - Path to the file
   * @param encoding - Character encoding (default: 'utf-8')
   * @returns File content as string or Buffer
   */
  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string | Buffer> {
    return withRetry(
      () => fs.readFile(path, encoding),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Write data to file with retry logic
   * @param path - Path to the file
   * @param data - Data to write (string or Buffer)
   * @param options - Write options (encoding, mode, flag)
   */
  async writeFile(path: string, data: string | Buffer, options?: WriteFileOptions): Promise<void> {
    return withRetry(
      () => fs.writeFile(path, data, options),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Write data to a new file without overwriting an existing file.
   * @param path - Path to the new file
   * @param data - Data to write (string or Buffer)
   * @param options - Write options (encoding, mode)
   */
  async writeFileNoClobber(path: string, data: string | Buffer, options?: WriteFileOptions): Promise<void> {
    const { flag: _flag, ...safeOptions } = options ?? {};
    return withRetry(
      () => fs.writeFile(path, data, { ...safeOptions, flag: 'wx' }),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Check if path exists with retry logic
   * @param path - Path to check
   * @returns true if path exists, false otherwise
   */
  async exists(path: string): Promise<boolean> {
    return withRetry(
      () => fs.pathExists(path),
      {
        retryableErrors: ['EBUSY', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Ensure directory exists with retry logic
   * Creates directory and all parent directories if they don't exist
   * @param path - Directory path
   */
  async ensureDir(path: string): Promise<void> {
    return withRetry(
      () => fs.ensureDir(path),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Remove file or directory with retry logic
   * @param path - Path to remove
   */
  async remove(path: string): Promise<void> {
    return withRetry(
      () => fs.remove(path),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Read directory contents with retry logic
   * @param path - Directory path
   * @returns Array of file/directory names
   */
  async readdir(path: string): Promise<string[]> {
    return withRetry(
      () => fs.readdir(path),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Append data to file with retry logic
   * @param path - Path to the file
   * @param data - Data to append (string or Buffer)
   * @param options - Write options (encoding)
   */
  async appendFile(path: string, data: string | Buffer, options?: WriteFileOptions): Promise<void> {
    return withRetry(
      () => fs.appendFile(path, data, options),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Copy file or directory with retry logic
   * @param src - Source path
   * @param dest - Destination path
   */
  async copy(src: string, dest: string): Promise<void> {
    return withRetry(
      () => fs.copy(src, dest),
      {
        retryableErrors: ['EBUSY', 'ENOENT', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Rename a file (atomic on most filesystems) with retry logic
   * @param oldPath - Current path
   * @param newPath - New path
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    return withRetry(
      () => fs.rename(oldPath, newPath),
      {
        retryableErrors: ['EBUSY', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }

  /**
   * Publish a temp file to a destination only if the destination
   * does not already exist.
   */
  async renameNoClobber(oldPath: string, newPath: string): Promise<void> {
    return withRetry(
      async () => {
        try {
          await fs.link(oldPath, newPath);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === 'EEXIST') {
            throw err;
          }
          throw err;
        }

        try {
          await fs.remove(oldPath);
        } catch (error) {
          try {
            await nodeFs.promises.unlink(newPath);
          } catch {
            // Best-effort rollback; surface the original cleanup error below.
          }
          throw error;
        }
      },
      {
        retryableErrors: ['EBUSY', 'EAGAIN', 'ETIMEDOUT'],
      }
    );
  }
}
