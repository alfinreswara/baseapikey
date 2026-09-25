import { ValidationError } from '@baseapikey/shared';

export interface ParsedAudioMultipart {
  fields: Record<string, string>;
  file: { data: Uint8Array; filename: string; contentType: string };
}

export function parseAudioMultipart(body: Buffer, contentTypeHeader: string): ParsedAudioMultipart {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentTypeHeader);
  const boundaryValue = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundaryValue) throw new ValidationError('Multipart boundary is missing');
  const delimiter = Buffer.from(`--${boundaryValue}`);
  const fields: Record<string, string> = {};
  let file: ParsedAudioMultipart['file'] | undefined;
  let cursor = body.indexOf(delimiter);

  while (cursor >= 0) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next < 0) break;
    let part = body.subarray(cursor + delimiter.length, next);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd > 0) {
      const headers = part.subarray(0, headerEnd).toString('latin1');
      const content = part.subarray(headerEnd + 4);
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (name && filename !== undefined) {
        const partContentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
        file = {
          data: new Uint8Array(content),
          filename: filename || 'audio.bin',
          contentType: partContentType ?? 'application/octet-stream',
        };
      } else if (name) {
        fields[name] = content.toString('utf8');
      }
    }
    cursor = next;
  }

  if (!file || file.data.length === 0) throw new ValidationError('Audio file is required');
  return { fields, file };
}
