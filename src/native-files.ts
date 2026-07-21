import { constants } from "node:fs"
import { dlopen } from "bun:ffi"

const libraryPath = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6"
const base = dlopen(libraryPath, {
  close: { args: ["i32"], returns: "i32" },
  flock: { args: ["i32", "i32"], returns: "i32" },
  fsync: { args: ["i32"], returns: "i32" },
  linkat: { args: ["i32", "ptr", "i32", "ptr", "i32"], returns: "i32" },
  openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
  unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
  write: { args: ["i32", "ptr", "usize"], returns: "i64" }
} as const)
const nativeStatFileAt = process.platform === "darwin" && process.arch === "x64"
  ? dlopen(libraryPath, {
      "fstatat$INODE64": { args: ["i32", "ptr", "ptr", "i32"], returns: "i32" }
    } as const).symbols["fstatat$INODE64"]!
  : dlopen(libraryPath, {
      fstatat: { args: ["i32", "ptr", "ptr", "i32"], returns: "i32" }
    } as const).symbols.fstatat!

const nameBuffer = (name: string): Buffer => Buffer.from(`${name}\0`, "utf8")

export interface NativeFileIdentity {
  readonly dev: number
  readonly ino: number
}

export const openFileAt = (directoryFd: number, name: string, flags: number, mode = 0): number =>
  base.symbols.openat!(directoryFd, nameBuffer(name), flags, mode)

export const createPrivateFileAt = (directoryFd: number, name: string): number =>
  openFileAt(directoryFd, name, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)

export const statFileAt = (directoryFd: number, name: string): NativeFileIdentity | null => {
  const stat = Buffer.alloc(256)
  const noFollow = process.platform === "darwin" ? 0x0020 : 0x0100
  if (nativeStatFileAt(directoryFd, nameBuffer(name), stat, noFollow) !== 0) return null
  return {
    dev: process.platform === "darwin" ? stat.readUInt32LE(0) : Number(stat.readBigUInt64LE(0)),
    ino: Number(stat.readBigUInt64LE(8))
  }
}

type DescriptorWriter = (fd: number, bytes: Uint8Array, length: number) => number

const nativeWrite: DescriptorWriter = (fd, bytes, length) => Number(base.symbols.write!(fd, bytes, length))

export const writeFileDescriptor = (fd: number, bytes: Uint8Array, writer: DescriptorWriter = nativeWrite): void => {
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = writer(fd, bytes.subarray(offset), bytes.byteLength - offset)
    if (written <= 0 || written > bytes.byteLength - offset) throw new Error("write failed")
    offset += written
  }
}

export const syncFileDescriptor = (fd: number): boolean => base.symbols.fsync!(fd) === 0

export const closeFileDescriptor = (fd: number): void => {
  if (base.symbols.close!(fd) !== 0) throw new Error("close failed")
}

export const tryUnlinkFileAt = (directoryFd: number, name: string): boolean =>
  base.symbols.unlinkat!(directoryFd, nameBuffer(name), 0) === 0

export const tryLinkFileAt = (directoryFd: number, source: string, destination: string): boolean =>
  base.symbols.linkat!(directoryFd, nameBuffer(source), directoryFd, nameBuffer(destination), 0) === 0

export const tryLockFileDescriptor = (fd: number): boolean => base.symbols.flock!(fd, 0x02 | 0x04) === 0

export const unlockFileDescriptor = (fd: number): void => {
  if (base.symbols.flock!(fd, 0x08) !== 0) throw new Error("unlock failed")
}
