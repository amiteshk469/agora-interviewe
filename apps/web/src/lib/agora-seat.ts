import type { AgoraConfig } from "@/lib/api";

/** Renew both Agora transports with one server-authorized seat token. */
export async function renewAgoraSeatTokens(
  renewConnection: () => Promise<AgoraConfig>,
  rtc: { renewToken: (token: string) => Promise<unknown> },
  rtm: { renewToken: (token: string) => Promise<unknown> },
) {
  const connection = await renewConnection();
  await rtc.renewToken(connection.token);
  await rtm.renewToken(connection.token);
  return connection;
}
