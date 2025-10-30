/**
 * Type definitions for @ffmpeg-installer/ffmpeg
 * This package provides platform-specific FFmpeg binaries
 */
declare module "@ffmpeg-installer/ffmpeg" {
  /**
   * Path to the FFmpeg binary for the current platform
   */
  export const path: string;

  /**
   * FFmpeg version string
   */
  export const version: string;

  /**
   * Download URL for the FFmpeg binary
   */
  export const url: string;
}

/**
 * Type definitions for @ffprobe-installer/ffprobe
 * This package provides platform-specific FFprobe binaries
 */
declare module "@ffprobe-installer/ffprobe" {
  /**
   * Path to the FFprobe binary for the current platform
   */
  export const path: string;

  /**
   * FFprobe version string
   */
  export const version: string;

  /**
   * Download URL for the FFprobe binary
   */
  export const url: string;
}
