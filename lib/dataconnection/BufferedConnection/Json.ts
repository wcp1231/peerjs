import { JsonChunker, concatArrayBuffers } from "./jsonChunker";
import logger from "../../logger";
import { BufferedConnection } from "./BufferedConnection";
import { SerializationType } from "../../enums";

export class Json extends BufferedConnection {
	private readonly chunker = new JsonChunker();
	readonly serialization = SerializationType.JSON;
	private readonly encoder = new TextEncoder();
	private readonly decoder = new TextDecoder();

	private _chunkedData: {
		[id: number]: {
			data: Uint8Array[];
			count: number;
			total: number;
		};
	} = {};

	stringify: (data: any) => string = JSON.stringify;
	parse: (data: string) => any = JSON.parse;

	public override close(options?: { flush?: boolean }) {
		super.close(options);
		this._chunkedData = {};
	}

	// Handles a DataChannel message.
	protected override _handleDataMessage({ data }: { data: Uint8Array }): void {
		const deserializedData = this.parse(this.decoder.decode(data));

		// PeerJS specific message
		const peerData = deserializedData["__peerData"];
		if (peerData) {
			if (peerData.type === "close") {
				this.close();
				return;
			}

			// Chunked data -- piece things back together.
			// @ts-ignore
			this._handleChunk(deserializedData);
			return;
		}

		this.emit("data", deserializedData);
	}

	private _handleChunk(data: {
		__peerData: number;
		n: number;
		total: number;
		data: string;
	}): void {
		const id = data.__peerData;
		const chunkInfo = this._chunkedData[id] || {
			data: [],
			count: 0,
			total: data.total,
		};

		const binaryString = atob(data.data);
		chunkInfo.data[data.n] = this.encoder.encode(binaryString);
		chunkInfo.count++;
		this._chunkedData[id] = chunkInfo;

		if (chunkInfo.total === chunkInfo.count) {
			// Clean up before making the recursive call to `_handleDataMessage`.
			delete this._chunkedData[id];

			// We've received all the chunks--time to construct the complete data.
			// const data = new Blob(chunkInfo.data);
			const data = concatArrayBuffers(chunkInfo.data);
			this._handleDataMessage({ data });
		}
	}

	override _send(data, chunked: boolean) {
		const encodedData = this.encoder.encode(this.stringify(data));

		if (!chunked && encodedData.byteLength > this.chunker.chunkedMTU) {
			this._sendChunks(encodedData);
			return;
		}

		this._bufferedSend(encodedData);
	}

	private _sendChunks(blob: ArrayBuffer) {
		const blobs = this.chunker.chunk(blob);
		logger.log(`DC#${this.connectionId} Try to send ${blobs.length} chunks...`);

		for (const blob of blobs) {
			this.send(blob, true);
		}
	}
}
