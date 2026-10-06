// Reads the device's own signals. Used to SUGGEST the existing LOW render and
// LOW BANDWIDTH switches — it never flips them without a tap.

export function deviceSignals() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const c = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  const reasons = [];
  if (c.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType)) reasons.push(`${c.effectiveType} connection`);
  if (c.saveData) reasons.push("Data Saver on");
  if (nav.deviceMemory && nav.deviceMemory <= 2) reasons.push(`${nav.deviceMemory} GB memory`);
  return {
    effectiveType: c.effectiveType || null,
    downlink: c.downlink || null,
    saveData: Boolean(c.saveData),
    deviceMemory: nav.deviceMemory || null,
    cores: nav.hardwareConcurrency || null,
    lowEnd: reasons.length > 0,
    reasons
  };
}
