const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** 对原始文件字节计算 SHA-256，统一为小写十六进制。 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data));
}

export async function hashFile(file: File): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}
