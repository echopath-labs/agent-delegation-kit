import { DelegationError } from "../errors.mjs";

export async function checkRouterHealth(profile, options = {}) {
  if (!profile.router) return { checked: false, healthy: true };
  const request = options.fetch ?? globalThis.fetch;
  let response;
  try {
    response = await request(profile.router.healthUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(profile.router.timeoutMs)
    });
  } catch {
    throw new DelegationError("router_unavailable", `The required router health check failed for profile ${profile.name}.`);
  }
  if (!response.ok) {
    throw new DelegationError("router_unavailable", `The required router health check returned HTTP ${response.status} for profile ${profile.name}.`);
  }
  return { checked: true, healthy: true, status: response.status };
}
