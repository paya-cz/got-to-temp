import fs from 'fs';
import stream from 'stream';
import temp from 'temp';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);
const finished = promisify(stream.finished);
const unlink = promisify(fs.unlink);

export interface GotRequest extends NodeJS.ReadableStream {
    retryCount: number;
}

export async function downloadToTempFile(
    createStreamRequest: () => GotRequest,
): Promise<{
    filePath: string;
}>;

export async function downloadToTempFile<T extends ReadonlyArray<NodeJS.ReadWriteStream>>(
    createStreamRequest: () => GotRequest,
    createTransforms: () => T,
): Promise<{
    filePath: string,
    transforms: T,
}>;

export async function downloadToTempFile<T extends ReadonlyArray<NodeJS.ReadWriteStream>>(
    createStreamRequest: () => GotRequest,
    createTransforms?: () => T,
): Promise<{
    filePath: string,
    transforms?: T,
}> {
    let retryCount: number | undefined = 0;
    
    while (true) {
        // Prepare transform streams
        const transforms = createTransforms?.();

        // Download stream
        const { stream: downloadStream, finished: downloadFinished } = watchGotStreamRetry(
            createStreamRequest(),
            retryCount,
        );

        // Temp file destination
        const tempFileStream = temp.createWriteStream();
        const tempFilePath = Buffer.isBuffer(tempFileStream.path) ? tempFileStream.path.toString() : tempFileStream.path;
        
        // Build a pipeline of streams
        const streams = [
            downloadStream,
            ...(transforms ?? []),
            tempFileStream,
        ];

        // Wait for the streams to complete, and capture any error
        let pipelineError: any = undefined;
        try {
            await pipeline(streams);
        } catch (error) {
            pipelineError = error;
        }

        // Wait until the streams finish cleanup
        // This will make sure the file handles are closed before we attempt to clean
        // up the temp file
        try {
            await Promise.all(
                streams.map(s => finished(s)),
            );
        } catch (error) {
            pipelineError ??= error;
        }

        // Check if Got asked for a retry
        ({ retryCount } = await downloadFinished);

        // Was download successful?
        if (retryCount == null && pipelineError == null) {
            return {
                filePath: tempFilePath,
                transforms,
            };
        }
        
        // Delete any previously downloaded data
        await unlink(tempFilePath);

        // If not retryable and there was an error, throw it
        if (retryCount == null) {
            throw pipelineError!;
        }
    }
}

function watchGotStreamRetry(gotStream: GotRequest, retryCount = 0): {
    stream: NodeJS.ReadableStream,
    finished: Promise<{
        retryCount: number | undefined,
    }>,
} {
	gotStream.retryCount = retryCount;

    return {
        stream: gotStream,
        finished: new Promise(resolve => {
            // If "retry" is called, it is called before "close"
            function onRetry(retryCount: number): void {
                resolve({
                    retryCount: retryCount ?? undefined,
                });
            }

            function cleanup(): void {
                gotStream.off('retry', onRetry);
                gotStream.off('close', cleanup);
                gotStream.off('end', cleanup);

                resolve({
                    retryCount: undefined,
                });
            }
        
            gotStream.once('retry', onRetry);
            gotStream.once('close', cleanup);
            gotStream.once('end', cleanup);
        }),
    };
}