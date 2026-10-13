import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('192.0.2.0', 24, 'ipv4');
blocked.addSubnet('198.51.100.0', 24, 'ipv4');
blocked.addSubnet('203.0.113.0', 24, 'ipv4');
blocked.addSubnet('224.0.0.0', 4, 'ipv4');
blocked.addAddress('255.255.255.255', 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  const lowered = address.toLowerCase();
  if (version === 6 && lowered.startsWith('::ffff:')) {
    const mapped = address.slice(address.lastIndexOf(':') + 1);
    if (isIP(mapped) === 4) return isPublicAddress(mapped);
  }
  return !blocked.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.internal'
  );
}

export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The provider URL is invalid.');
  }
  if (url.username || url.password) throw new Error('The provider URL is not allowed.');
  if (url.protocol !== 'https:') throw new Error('The provider URL must use HTTPS.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (blockedHostname(host)) throw new Error('The provider URL is not allowed.');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('The provider URL is not allowed.');
    return url;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0) throw new Error('The provider URL is not allowed.');
  for (const record of records) {
    if (!isPublicAddress(record.address)) throw new Error('The provider URL is not allowed.');
  }
  return url;
}

const MAX_BYTES = 50 * 1024 * 1024;

export async function fetchPublicHttps(raw: string, headers?: Record<string, string>): Promise<Buffer> {
  let current = await assertPublicHttpsUrl(raw);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { redirect: 'manual', headers });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The provider redirect is invalid.');
      current = await assertPublicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Provider download failed with status ${response.status}.`);
    const advertised = Number(response.headers.get('content-length') ?? 0);
    if (advertised > MAX_BYTES) throw new Error('The provider file is too large.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('The provider file is too large.');
    return bytes;
  }
  throw new Error('The provider redirect is invalid.');
}
