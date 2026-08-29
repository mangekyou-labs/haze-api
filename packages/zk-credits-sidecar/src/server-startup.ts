export interface SidecarServerActivation {
  listen(): Promise<string>;
  publishToken(): Promise<void>;
}

/** Makes the bearer discoverable only after this process owns the port. */
export async function activateSidecarServer(
  activation: SidecarServerActivation,
): Promise<string> {
  const address = await activation.listen();
  await activation.publishToken();
  return address;
}
