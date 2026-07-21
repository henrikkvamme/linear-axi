import { constants, fstatSync } from "node:fs"
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
const renameAtX = process.platform === "darwin"
  ? dlopen(libraryPath, {
      renameatx_np: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" }
    } as const)
  : null
const renameAt2 = process.platform === "darwin"
  ? null
  : dlopen(libraryPath, {
      renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" }
    } as const)

const nameBuffer = (name: string): Buffer => Buffer.from(`${name}\0`, "utf8")

export interface NativeFileIdentity {
  readonly dev: number
  readonly ino: number
}

export const openFileAt = (directoryFd: number, name: string, flags: number, mode = 0): number =>
  base.symbols.openat!(directoryFd, nameBuffer(name), flags, mode)

export const createPrivateFileAt = (directoryFd: number, name: string): number =>
  openFileAt(directoryFd, name, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)

export const statFileDescriptor = (fd: number): NativeFileIdentity => {
  const stat = fstatSync(fd)
  return { dev: Number(stat.dev), ino: Number(stat.ino) }
}

export const statFileAt = (directoryFd: number, name: string): NativeFileIdentity | null => {
  const fd = openFileAt(directoryFd, name, constants.O_RDONLY | constants.O_NOFOLLOW)
  if (fd < 0) return null
  try {
    return statFileDescriptor(fd)
  } finally {
    closeFileDescriptor(fd)
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

export const tryExchangeFilesAt = (directoryFd: number, first: string, second: string): boolean => {
  const firstName = nameBuffer(first)
  const secondName = nameBuffer(second)
  return renameAtX !== null
    ? renameAtX.symbols.renameatx_np!(directoryFd, firstName, directoryFd, secondName, 0x00000002) === 0
    : renameAt2!.symbols.renameat2!(directoryFd, firstName, directoryFd, secondName, 0x00000002) === 0
}

export const tryLockFileDescriptor = (fd: number): boolean => base.symbols.flock!(fd, 0x02 | 0x04) === 0

export const unlockFileDescriptor = (fd: number): void => {
  if (base.symbols.flock!(fd, 0x08) !== 0) throw new Error("unlock failed")
}
