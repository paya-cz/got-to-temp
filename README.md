# got-to-temp

First, use [Got](https://www.npmjs.com/package/got) to create retryable read stream.

`@mangosteen/got-to-temp` then helps you to:
- Automatically retry on failures
- Stream `Got` response data to a temp file that is automatically created for you
- Optionally, use [transform streams](https://nodejs.org/api/stream.html#stream_implementing_a_transform_stream) to modify the stream data on-the-fly

If there are any failures during download, the temp file is automatically cleaned up.

If there are any errors during download and `Got` ran out of retries, the error is propagated via rejected promise.

# Installation

With [npm](https://www.npmjs.com/) do:

    $ npm install @mangosteen/got-to-temp

# Usage

```ts
import { downloadToTempFile } from '@mangosteen/got-to-temp';
import { DigestStream } from '@mangosteen/digest-stream';
import got from 'got';
import crypto from 'crypto';

(async () => {
    // Setup Got with retry
    const gotClient = got.extend({
        retry: {
            limit: 5,
        },
    });

    // If Got runs out of retries, this promise will reject with Got error
    const downloadResult = await downloadToTempFile(
        // Factory method to create download stream
        () => gotClient.stream.get('https://nodejs.org/dist/v14.17.5/node-v14.17.5.tar.gz'),
        // Optional factory method to create transform streams
        () => [
            // We use digest as an example here to show how to compute SHA-256 while
            // the file is being downloaded. You may use any other transform streams,
            // or simply avoid passing this factory method altogether.
            new DigestStream({
                digest: crypto.createHash('sha256'),
            }),
        ] as const,
    );

    // Path to a file in a temp directory containing the downloaded data
    console.log(downloadResult.filePath);

    // Access the transform stream instances used during download
    console.log(
        downloadResult.transforms[0].digest().toString('hex'),
    );
})();
```