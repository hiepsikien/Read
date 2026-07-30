import { createApiClient } from "@read/api-client";
import { cookies } from "next/headers";
import { TOKEN_KEY, getApiBaseUrl } from "./api";

export async function createServerApi() {
  const jar = await cookies();
  const token = jar.get(TOKEN_KEY)?.value ?? null;
  return createApiClient({
    baseUrl: getApiBaseUrl(),
    getToken: () => token,
  });
}
