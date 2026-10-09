import * as stream from 'stream';
import { ArchiverOptions, EntryData, ZipEntryData, TarEntryData, ProgressData, ArchiverError } from 'archiver';

declare module 'archiver' {
  export interface Archiver extends stream.Transform {
    abort(): this;
    append(source: stream.Readable | Buffer | string, data?: EntryData | ZipEntryData | TarEntryData): this;
    directory(dirpath: string, destpath: false | string, data?: unknown): this;
    file(filename: string, data?: EntryData): this;
    glob(pattern: string, options?: unknown, data?: unknown): this;
    finalize(): Promise<void>;
    pointer(): number;
    symlink(filepath: string, target: string, mode?: number): this;
    on(event: 'error' | 'warning', listener: (error: ArchiverError) => void): this;
    on(event: 'data', listener: (data: Buffer) => void): this;
    on(event: 'progress', listener: (progress: ProgressData) => void): this;
    on(event: 'close' | 'drain' | 'finish', listener: () => void): this;
    on(event: 'pipe' | 'unpipe', listener: (src: stream.Readable) => void): this;
    on(event: 'entry', listener: (entry: EntryData) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  function archiver(format: 'zip' | 'tar', options?: ArchiverOptions): Archiver;
  export default archiver;
}
