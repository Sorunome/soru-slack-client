import { Buffer } from "buffer";
import got from "got";

export class Util {
	// tslint:disable-next-line no-any
	public static async DownloadFile(url: string, options: any = {}): Promise<Buffer> {
		if (!options.method) {
			options.method = "GET";
		}
		options.url = url;
		return await got(options).buffer();
	}
}
