import ipaddr from 'ipaddr.js';
import { RE2JS } from 're2js';
import { createPrivacyRedaction } from '../../domain/aiPrivacyRedaction.shared.cjs';
import { createPrivacyServiceFactory } from '../../domain/aiPrivacyService.shared.cjs';

// Same detector and session/policy lifecycle as desktop. Only Node platform
// primitives are replaced; maps stay in this module's closure, never persisted.
class BlockList {
  private ranges: Array<[ReturnType<typeof ipaddr.parse>, number]> = [];
  addSubnet(address: string, prefix: number) { this.ranges.push([ipaddr.parse(address), prefix]); }
  check(address: string) {
    const raw = ipaddr.parse(address);
    const parsed = raw.kind() === 'ipv6' && (raw as any).isIPv4MappedAddress() ? (raw as any).toIPv4Address() : raw;
    return this.ranges.some(([range, prefix]) => range.kind() === parsed.kind() && (parsed as any).match(range, prefix));
  }
}
const redaction = createPrivacyRedaction({
  RE2JS, BlockList,
  isIP(address: string) {
    if (!ipaddr.isValid(address)) return 0;
    // Node rejects abbreviated, octal and hexadecimal IPv4 literals.
    if (!address.includes(':') && !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return 0;
    return ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6;
  },
  randomBytes(size: number) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    return { toString: () => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
  },
  Buffer: { byteLength: (text: string) => new TextEncoder().encode(text).length },
});
export function createAndroidPrivacyService() {
  const service = createPrivacyServiceFactory(redaction).createAiPrivacyService();
  // Android must never silently start disabled. Saved validated policy is
  // reconciled by the shared settings publisher; disabling needs user consent.
  service.configure({enabled: true});
  return service;
}
export function installAndroidPrivacyFactory() {
  (window as any).__createAndroidPrivacyService = createAndroidPrivacyService;
}
