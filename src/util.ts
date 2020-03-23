import { Buffer } from "buffer";
import * as request from "request-promise";

export class Util {
	// tslint:disable-next-line no-any
	public static async DownloadFile(url: string, options: any = {}): Promise<Buffer> {
		if (!options.method) {
			options.method = "GET";
		}
		options.url = url;
		options.encoding = null;
		return await request(options);
	}
}
