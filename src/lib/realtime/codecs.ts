import { validateMessage, type Message } from "./contract";
export interface Codec {
  subprotocol: string;
  encode(value: unknown): string | ArrayBuffer;
  decode(frame: unknown): Message;
}
export const jsonCodec: Codec = {
  subprotocol: "refract.json.v1",
  encode: JSON.stringify,
  decode: (frame) =>
    validateMessage(
      JSON.parse(typeof frame === "string" ? frame : new TextDecoder().decode(frame as ArrayBuffer))
    ),
};
/** Compact envelope: UTF-8 binary JSON tuple, omitting repeated envelope keys. No dependency. */
export const tupleCodec: Codec = {
  subprotocol: "refract.tuple.v1",
  encode(value) {
    const m = value as Message;
    const wire =
      m.topic && "payload" in m
        ? [m.topic, m.payload, m.entityId ?? null, m.version ?? null, m.timestamp ?? null]
        : value;
    return new TextEncoder().encode(JSON.stringify(wire)).buffer as ArrayBuffer;
  },
  decode(frame) {
    const tuple: unknown = JSON.parse(new TextDecoder().decode(frame as ArrayBuffer));
    if (!Array.isArray(tuple) || tuple.length !== 5) throw new Error("Invalid tuple");
    return validateMessage({
      topic: tuple[0],
      payload: tuple[1],
      entityId: tuple[2] ?? undefined,
      version: tuple[3] ?? undefined,
      timestamp: tuple[4] ?? undefined,
    });
  },
};
export const codecs = [jsonCodec, tupleCodec];
export const selectCodec = (protocol: string): Codec =>
  codecs.find((c) => c.subprotocol === protocol) ?? jsonCodec;
