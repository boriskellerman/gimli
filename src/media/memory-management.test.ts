/**
 * Tests verifying that the media pipeline handles images/audio without memory leaks.
 *
 * The media pipeline uses several key patterns to prevent memory leaks:
 * 1. withTempDir() - Cleans temp directories in finally blocks
 * 2. Stream size guards - Cancels streams early when limits exceeded
 * 3. TTL-based cleanup - Auto-removes old media files
 * 4. Buffer size limits - Prevents uncontrolled memory growth
 *
 * These tests verify these patterns work correctly, including error scenarios.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

describe("media pipeline memory management", () => {
  let home = "";
  const envSnapshot: Record<string, string | undefined> = {};

  const snapshotEnv = () => {
    for (const key of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "GIMLI_STATE_DIR"]) {
      envSnapshot[key] = process.env[key];
    }
  };

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  beforeAll(async () => {
    snapshotEnv();
    home = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-media-mem-test-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.GIMLI_STATE_DIR = path.join(home, ".gimli");
    if (process.platform === "win32") {
      const match = home.match(/^([A-Za-z]:)(.*)$/);
      if (match) {
        process.env.HOMEDRIVE = match[1];
        process.env.HOMEPATH = match[2] || "\\";
      }
    }
    await fs.mkdir(path.join(home, ".gimli"), { recursive: true });
  });

  afterAll(async () => {
    restoreEnv();
    try {
      await fs.rm(home, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  });

  describe("temp directory cleanup (withTempDir pattern)", () => {
    it("cleans up temp directory after successful image resize operation", async () => {
      const imageOps = await import("./image-ops.js");
      const tmpdir = os.tmpdir();

      // Get initial count of gimli-img- directories
      const beforeDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));

      // Create a test image and resize it
      const testImage = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#ff0000" },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Perform resize operation (uses withTempDir internally when sips backend is used)
      await imageOps.resizeToJpeg({
        buffer: testImage,
        maxSide: 50,
        quality: 80,
      });

      // Give filesystem time to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that no new gimli-img- directories remain
      const afterDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));
      expect(afterDirs.length).toBe(beforeDirs.length);
    });

    it("cleans up temp directory even when image operation fails", async () => {
      const imageOps = await import("./image-ops.js");
      const tmpdir = os.tmpdir();

      // Get initial count of gimli-img- directories
      const beforeDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));

      // Try to process invalid image data
      const invalidImage = Buffer.from("not an image");

      try {
        await imageOps.resizeToJpeg({
          buffer: invalidImage,
          maxSide: 50,
          quality: 80,
        });
      } catch {
        // Expected to fail
      }

      // Give filesystem time to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify no temp directories leaked
      const afterDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));
      expect(afterDirs.length).toBe(beforeDirs.length);
    });

    it("cleans up temp directory after EXIF orientation normalization", async () => {
      const imageOps = await import("./image-ops.js");
      const tmpdir = os.tmpdir();

      const beforeDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));

      // Create a JPEG with EXIF metadata
      const testImage = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#00ff00" },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Normalize EXIF orientation
      await imageOps.normalizeExifOrientation(testImage);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const afterDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));
      expect(afterDirs.length).toBe(beforeDirs.length);
    });

    it("cleans up temp directory after HEIC to JPEG conversion", async () => {
      const imageOps = await import("./image-ops.js");
      const tmpdir = os.tmpdir();

      const beforeDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));

      // Create a test image (we'll use a regular JPEG since we don't have HEIC test data)
      const testImage = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#0000ff" },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Try HEIC conversion (will just pass through for non-HEIC)
      await imageOps.convertHeicToJpeg(testImage);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const afterDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));
      expect(afterDirs.length).toBe(beforeDirs.length);
    });
  });

  describe("stream size guards (fetch operations)", () => {
    it("rejects when stream exceeds maxBytes limit", async () => {
      const { fetchRemoteMedia, MediaFetchError } = await import("./fetch.js");

      // Create a real ReadableStream that exceeds the limit
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.enqueue(new Uint8Array([7, 8, 9]));
          controller.close();
        },
      });

      const fetchImpl = async () =>
        new Response(stream, {
          status: 200,
        });

      // Should throw when exceeding 5 bytes limit
      await expect(
        fetchRemoteMedia({
          url: "https://example.com/file.bin",
          fetchImpl,
          maxBytes: 5,
        }),
      ).rejects.toThrow(MediaFetchError);
    });

    it("successfully reads stream within size limit", async () => {
      const { fetchRemoteMedia } = await import("./fetch.js");

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });

      const fetchImpl = async () =>
        new Response(stream, {
          status: 200,
        });

      const result = await fetchRemoteMedia({
        url: "https://example.com/file.bin",
        fetchImpl,
        maxBytes: 100,
      });

      expect(result.buffer.length).toBe(3);
    });

    it("handles empty stream without memory issues", async () => {
      const { fetchRemoteMedia } = await import("./fetch.js");

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      const fetchImpl = async () =>
        new Response(stream, {
          status: 200,
        });

      const result = await fetchRemoteMedia({
        url: "https://example.com/file.bin",
        fetchImpl,
        maxBytes: 100,
      });

      expect(result.buffer.length).toBe(0);
    });
  });

  describe("TTL-based media cleanup", () => {
    it("removes media files older than TTL threshold", async () => {
      const store = await import("./store.js");

      // Ensure media dir exists and create a test file directly in base media dir
      const mediaDir = await store.ensureMediaDir();
      const testFile = path.join(mediaDir, "test-old-file.txt");
      await fs.writeFile(testFile, "test content", { mode: 0o600 });

      // Verify file exists
      await expect(fs.stat(testFile)).resolves.toBeTruthy();

      // Make the file look old (10 seconds ago)
      const past = Date.now() - 10_000;
      await fs.utimes(testFile, past / 1000, past / 1000);

      // Clean with 1ms TTL (should remove the file)
      await store.cleanOldMedia(1);

      // Verify file was removed
      await expect(fs.stat(testFile)).rejects.toThrow();
    });

    it("preserves media files within TTL threshold", async () => {
      const store = await import("./store.js");

      // Create file directly in base media dir
      const mediaDir = await store.ensureMediaDir();
      const testFile = path.join(mediaDir, "test-fresh-file.txt");
      await fs.writeFile(testFile, "fresh content", { mode: 0o600 });

      // Clean with 1 hour TTL (should keep the file)
      await store.cleanOldMedia(60 * 60 * 1000);

      // Verify file still exists
      await expect(fs.stat(testFile)).resolves.toBeTruthy();

      // Cleanup
      await fs.rm(testFile).catch(() => {});
    });

    it("handles concurrent cleanup operations safely", async () => {
      const store = await import("./store.js");

      // Create multiple test files directly in base media dir
      const mediaDir = await store.ensureMediaDir();
      const files = [
        path.join(mediaDir, "test-concurrent-1.txt"),
        path.join(mediaDir, "test-concurrent-2.txt"),
        path.join(mediaDir, "test-concurrent-3.txt"),
      ];

      await Promise.all(files.map((f) => fs.writeFile(f, "test", { mode: 0o600 })));

      // Make files old
      const past = Date.now() - 10_000;
      await Promise.all(files.map((f) => fs.utimes(f, past / 1000, past / 1000)));

      // Run multiple cleanups concurrently
      await Promise.all([store.cleanOldMedia(1), store.cleanOldMedia(1), store.cleanOldMedia(1)]);

      // All files should be gone (no errors from concurrent access)
      for (const file of files) {
        await expect(fs.stat(file)).rejects.toThrow();
      }
    });
  });

  describe("buffer size limits", () => {
    it("rejects buffers exceeding media store max bytes limit", async () => {
      const store = await import("./store.js");

      // Try to save a buffer exceeding the 5MB limit
      const huge = Buffer.alloc(5 * 1024 * 1024 + 1);

      await expect(store.saveMediaBuffer(huge)).rejects.toThrow("Media exceeds 5MB limit");
    });

    it("respects custom max bytes parameter", async () => {
      const store = await import("./store.js");

      const buf = Buffer.alloc(1024); // 1KB

      // Should succeed with 2KB limit
      const saved = await store.saveMediaBuffer(buf, "application/octet-stream", "test", 2048);
      expect(saved.size).toBe(1024);
      await fs.rm(saved.path).catch(() => {});

      // Should fail with 512 byte limit
      await expect(
        store.saveMediaBuffer(buf, "application/octet-stream", "test", 512),
      ).rejects.toThrow("exceeds");
    });

    it("enforces content-length check before streaming", async () => {
      const { fetchRemoteMedia } = await import("./fetch.js");

      // Create a mock fetch that returns large content-length header
      const fetchImpl = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-length": "10000000" }, // 10MB
          },
        );

      await expect(
        fetchRemoteMedia({
          url: "https://example.com/large.bin",
          fetchImpl,
          maxBytes: 1000,
        }),
      ).rejects.toThrow("exceeds maxBytes");
    });
  });

  describe("concurrent image operations memory isolation", () => {
    it("handles multiple concurrent resize operations without memory interference", async () => {
      const imageOps = await import("./image-ops.js");

      // Create multiple test images with different colors
      const images = await Promise.all([
        sharp({ create: { width: 200, height: 200, channels: 3, background: "#ff0000" } })
          .jpeg({ quality: 80 })
          .toBuffer(),
        sharp({ create: { width: 200, height: 200, channels: 3, background: "#00ff00" } })
          .jpeg({ quality: 80 })
          .toBuffer(),
        sharp({ create: { width: 200, height: 200, channels: 3, background: "#0000ff" } })
          .jpeg({ quality: 80 })
          .toBuffer(),
      ]);

      // Process all concurrently
      const results = await Promise.all(
        images.map((img) =>
          imageOps.resizeToJpeg({
            buffer: img,
            maxSide: 50,
            quality: 80,
          }),
        ),
      );

      // Verify all results are valid JPEGs with correct size
      for (const result of results) {
        const meta = await sharp(result).metadata();
        expect(meta.format).toBe("jpeg");
        expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(50);
      }
    });

    it("concurrent operations use separate temp directories", async () => {
      const imageOps = await import("./image-ops.js");
      const tmpdir = os.tmpdir();

      const beforeDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));

      // Create test images
      const images = await Promise.all(
        Array(5)
          .fill(null)
          .map((_, i) =>
            sharp({
              create: {
                width: 100,
                height: 100,
                channels: 3,
                background: `#${i.toString(16).repeat(6).slice(0, 6)}`,
              },
            })
              .jpeg({ quality: 80 })
              .toBuffer(),
          ),
      );

      // Process all concurrently
      await Promise.all(
        images.map((img) =>
          imageOps.resizeToJpeg({
            buffer: img,
            maxSide: 50,
            quality: 80,
          }),
        ),
      );

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify no temp directories leaked
      const afterDirs = (await fs.readdir(tmpdir)).filter((d) => d.startsWith("gimli-img-"));
      expect(afterDirs.length).toBe(beforeDirs.length);
    });
  });

  describe("PNG optimization memory management", () => {
    it("does not accumulate buffers during grid search optimization", async () => {
      const imageOps = await import("./image-ops.js");

      // Create a large-ish PNG with alpha channel
      const testImage = await sharp({
        create: {
          width: 500,
          height: 500,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer();

      // Run optimization (tries multiple size/compression combinations)
      const result = await imageOps.optimizeImageToPng(testImage, 100 * 1024); // 100KB limit

      // Verify result is valid
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.optimizedSize).toBe(result.buffer.length);

      const meta = await sharp(result.buffer).metadata();
      expect(meta.format).toBe("png");
    });

    it("returns smallest result when all attempts exceed target", async () => {
      const imageOps = await import("./image-ops.js");

      // Create an image that will be hard to compress to very small size
      const testImage = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      // Try with impossibly small target (1 byte)
      const result = await imageOps.optimizeImageToPng(testImage, 1);

      // Should still return a result (the smallest it could achieve)
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  describe("image metadata extraction memory safety", () => {
    it("does not leak memory when getting metadata from valid image", async () => {
      const imageOps = await import("./image-ops.js");

      const testImage = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const metadata = await imageOps.getImageMetadata(testImage);

      expect(metadata).toEqual({ width: 100, height: 100 });
    });

    it("returns null without throwing for invalid image data", async () => {
      const imageOps = await import("./image-ops.js");

      const invalidData = Buffer.from("not an image at all");

      const metadata = await imageOps.getImageMetadata(invalidData);

      expect(metadata).toBeNull();
    });

    it("returns null for truncated image data", async () => {
      const imageOps = await import("./image-ops.js");

      // Create valid JPEG and truncate it
      const validImage = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#000000" },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const truncated = validImage.subarray(0, 100);

      const metadata = await imageOps.getImageMetadata(truncated);

      // Should return null without crashing
      expect(metadata).toBeNull();
    });
  });

  describe("alpha channel detection memory safety", () => {
    it("correctly detects alpha channel in PNG", async () => {
      const imageOps = await import("./image-ops.js");

      const withAlpha = await sharp({
        create: {
          width: 10,
          height: 10,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer();

      const withoutAlpha = await sharp({
        create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
      })
        .png()
        .toBuffer();

      expect(await imageOps.hasAlphaChannel(withAlpha)).toBe(true);
      expect(await imageOps.hasAlphaChannel(withoutAlpha)).toBe(false);
    });

    it("returns false for invalid images without throwing", async () => {
      const imageOps = await import("./image-ops.js");

      const invalidData = Buffer.from("not an image");

      // Should return false, not throw
      expect(await imageOps.hasAlphaChannel(invalidData)).toBe(false);
    });
  });

  describe("EXIF orientation parsing memory safety", () => {
    it("handles non-JPEG data without memory issues", async () => {
      const imageOps = await import("./image-ops.js");

      // PNG has no EXIF orientation
      const pngImage = await sharp({
        create: { width: 50, height: 50, channels: 3, background: "#123456" },
      })
        .png()
        .toBuffer();

      // Should return the buffer unchanged
      const result = await imageOps.normalizeExifOrientation(pngImage);
      expect(result.length).toBe(pngImage.length);
    });

    it("handles corrupted JPEG data gracefully", async () => {
      const imageOps = await import("./image-ops.js");

      // Create buffer with JPEG magic bytes but invalid content
      const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, ...Buffer.alloc(20)]);

      // Should return buffer unchanged without crashing
      const result = await imageOps.normalizeExifOrientation(corruptJpeg);
      expect(result).toBeTruthy();
    });
  });
});
