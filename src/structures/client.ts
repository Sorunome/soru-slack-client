import { RTMClient } from "@slack/rtm-api";
import { WebClient, WebAPICallResult } from "@slack/web-api";
import { SlackEventAdapter } from "@slack/events-api/dist/adapter";
import { EventEmitter } from "events";
import { IUserData, User } from "./user";
import { IChannelData, Channel } from "./channel";
import { ITeamData, Team } from "./team";
import { Message } from "./message";
import { Reaction } from "./reaction";
import * as ua from "useragent-generator";
import * as express from "express";

export interface IClientOpts {
	token?: string;
	cookie?: string;
	noRtm?: boolean;
	events?: {
		express: {
			app: express.Application,
			path: string,
		};
		appId: string;
		clientId: string;
		clientSecret: string;
		signingSecret: string;
	};
}

export class Client extends EventEmitter {
	private webMap: Map<string, WebClient> = new Map();
	private rtmMap: Map<string, RTMClient> = new Map();
	private tokenMap: Map<string, string> = new Map();
	private events: SlackEventAdapter | null = null;
	private startup: Set<string> = new Set();
	public teams: Map<string, Team> = new Map();
	public users: Map<string, User> = new Map();
	constructor(private opts: IClientOpts) {
		super();
	}

	public web(teamId: string): WebClient {
		const web = this.webMap.get(teamId);
		if (!web) {
			throw new Error("Team not found");
		}
		return web;
	}

	public rtm(teamId: string): RTMClient {
		const rtm = this.rtmMap.get(teamId);
		if (!rtm) {
			throw new Error("Team not found");
		}
		return rtm;
	}

	public async disconnect() {
		for (const [, rtm ] of this.rtmMap) {
			await rtm.disconnect();
		}
		if (this.events) {
			await this.events.stop();
		}
	}

	public async connect() {
		if (this.opts.token) {
			await this.addToken(this.opts.token);
		}
		if (this.opts.events) {
			await this.connectToEventsApi();
		}
	}

	public async addToken(token: string, teamId: string = "", userId: string = "") {
		const useragent = ua.chrome("79.0.3945.117");
		// tslint:disable-next-line no-any
		const webHeaders: any = this.opts.cookie ? { headers: {
			"Cookie": `d=${this.opts.cookie}`,
			"User-Agent": useragent,
		}} : {};
		const web = new WebClient(token, webHeaders);
		if (teamId) {
			this.startup.add(teamId);
			this.webMap.set(teamId, web);
			this.addTeam({
				id: teamId,
				name: teamId,
			});
			const clientTeam = this.teams.get(teamId);
			if (clientTeam && clientTeam.partial) {
				await clientTeam.load();
			}
		}
		if (userId) {
			this.addUser({
				id: userId,
				name: userId,
				team_id: teamId,
			});
			const clientUser = this.getUser(userId, teamId);
			if (clientUser) {
				this.users.set(teamId, clientUser);
				if (clientUser.partial) {
					await clientUser.load();
				}
			}
		}
		if (this.opts.noRtm) {
			if (teamId) {
				this.startup.delete(teamId);
			}
			return;
		}
		// tslint:disable-next-line no-any
		const rtmHeaders: any = this.opts.cookie ? { tls: { headers: {
			"Cookie": `d=${this.opts.cookie}`,
			"User-Agent": useragent,
		}}} : {};
		const rtm = new RTMClient(token, rtmHeaders);
		return new Promise(async (resolve, reject) => {
			rtm.once("unable_to_rtm_start", (err) => {
				if (err.data && err.data.error === "not_allowed_token_type" && this.opts.events) {
					resolve();
				} else {
					reject(err);
				}
			});

			rtm.on("disconnected", () => {
				this.emit("disconnected");
			});

			rtm.on("authenticated", async (data) => {
				teamId = data.team.id as string;
				this.startup.add(teamId);
				this.rtmMap.set(teamId, rtm);
				this.webMap.set(teamId, web);
				this.tokenMap.set(token, teamId);
				this.addTeam(data.team);
				this.addUser({
					id: data.self.id as string,
					name: data.self.name as string,
					team_id: data.team.id as string,
				});
				const clientUser = this.getUser(data.self.id, data.team.id);
				if (clientUser) {
					this.users.set(teamId, clientUser);
				}
				const clientTeam = this.teams.get(data.team.id);
				if (clientTeam && clientTeam.partial) {
					await clientTeam.load();
				}
				this.startup.delete(teamId);
			});

			rtm.on("ready", () => {
				resolve();
				this.emit("connected");
			})

			for (const ev of ["channel_joined", "group_joined", "mpim_joined", "im_created", "channel_created", "channel_rename", "group_rename"]) {
				rtm.on(ev, (data) => {
					data.channel.team_id = teamId;
					this.addChannel(data.channel);
				});
			}

			for (const ev of ["team_join", "user_change"]) {
				rtm.on(ev, (data) => {
					data.user.team_id = teamId;
					this.addUser(data.user);
				});
			}

			for (const ev of ["bot_added", "bot_changed"]) {
				rtm.on(ev, (data) => {
					data.bot.team_id = teamId;
					this.addUser(data.bot);
				});
			}

			for (const ev of ["team_profile_change", "team_pref_change"]) {
				rtm.on("team_pref_change", async () => {
					const ret = await this.web(teamId).team.info({
						team: teamId,
					});
					if (!ret || !ret.ok || !ret.team) {
						return;
					}
					this.addTeam(ret.team as ITeamData);
				});
			}

			rtm.on("team_rename", (data) => {
				this.addTeam({
					id: teamId,
					name: data.name,
				});
			});

			if (!this.opts.events) {
				rtm.on("message", (data) => {
					data.team_id = teamId;
					this.handleMessageEvent(data);
				});

				rtm.on("reaction_added", (data) => {
					const reaction = new Reaction(this, data, teamId);
					this.emit("reactionAdded", reaction);
				});

				rtm.on("reaction_removed", (data) => {
					const reaction = new Reaction(this, data, teamId);
					this.emit("reactionRemoved", reaction);
				});
			}

			rtm.on("user_typing", (data) => {
				const channel = this.getChannel(data.channel, teamId);
				const user = this.getUser(data.user || data.bot_id, teamId);
				if (channel && user) {
					this.emit("typing", channel, user);
				}
			});

			rtm.on("presence_change", (data) => {
				const user = this.getUser(data.user || data.bot_id, teamId);
				if (user) {
					this.emit("presenceChange", user, data.presence);
				}
			});

			try {
				await rtm.start();
			} catch (err) {
				reject(err);
			}
		});
	}

	public async connectToEventsApi() {
		if (!this.opts.events) {
			return;
		}
		this.events = new SlackEventAdapter(this.opts.events.signingSecret, {
			includeBody: true,
		});
		this.opts.events.express.app.use(this.opts.events.express.path + "/events", this.events.requestListener());

		this.opts.events.express.app.get(this.opts.events.express.path + "/oauth/" + encodeURIComponent(this.opts.events.appId),
			async (req: express.Request, res: express.Response) => {
			const data = await (new WebClient()).oauth.v2.access({
				client_id: this.opts.events!.clientId,
				client_secret: this.opts.events!.clientSecret,
				code: req.query.code,
			});
			if (data.app_id !== this.opts.events!.appId) {
				return;
			}
			const STATUS_FORBIDDEN = 403;
			if (!data || !data.ok) {
				res.status(STATUS_FORBIDDEN).send(this.getHtmlResponse("Failed to get OAuth token", encodeURIComponent(data.error as string)));
				return;
			}
			const teamId = (data.team as any).id;
			await this.addToken((data as any).access_token, teamId, (data as any).bot_user_id);
			
			const newTeam = this.teams.get(teamId);
			if (newTeam) {
				this.startup.add(teamId);
				await newTeam.joinAllChannels();
				this.startup.delete(teamId);
			}
			res.send(this.getHtmlResponse("Successfully added slack bot to team", ""));
		});

		this.events.on("app_uninstalled", async (data) => {
			if (data.api_app_id !== this.opts.events!.appId) {
				return;
			}
			const teamId = data.team_id;
			const rtm = this.rtmMap.get(teamId);
			if (rtm) {
				await rtm.disconnect();
			}
			this.webMap.delete(teamId);
			this.rtmMap.delete(teamId);
			for (const [token, tid] of this.tokenMap) {
				if (tid === teamId) {
					this.tokenMap.delete(token);
				}
			}
			this.teams.delete(teamId);
			this.users.delete(teamId);
		});

		this.events.on("message", (data, evt) => {
			if (evt.api_app_id !== this.opts.events!.appId) {
				return;
			}
			data.team_id = evt.team_id;
			this.handleMessageEvent(data);
		});

		this.events.on("reaction_added", (data, evt) => {
			if (evt.api_app_id !== this.opts.events!.appId) {
				return;
			}
			const reaction = new Reaction(this, data, evt.team_id);
			this.emit("reactionAdded", reaction);
		});

		this.events.on("reaction_removed", (data, evt) => {
			if (evt.api_app_id !== this.opts.events!.appId) {
				return;
			}
			const reaction = new Reaction(this, data, evt.team_id);
			this.emit("reactionRemoved", reaction);
		});

		this.events.on("error", (error) => {
			console.log("+++++++++++*");
			console.log(error);
		});
	}

	public addUser(data: IUserData, createTeam = true) {
		const team = this.teams.get(data.team_id);
		const userId = (data.id || data.bot_id) as string;
		if (team) {
			const user = team.users.get(userId);
			if (user) {
				const oldUser = user._clone();
				user._patch(data);
				if (!this.startup.has(team.id) && !user.fullBot) {
					this.emit("changeUser", oldUser, user);
				}
			} else {
				const newUser = new User(this, data);
				team.users.set(newUser.id, newUser);
				if (this.rtmMap.has(team.id)) {
					this.rtm(team.id).subscribePresence([newUser.id]);
				}
				if (!this.startup.has(team.id) && !newUser.fullBot) {
					this.emit("addUser", newUser);
				}
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any
			this.web(data.team_id).team.info({ team: data.team_id }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addUser(data, false);
				}
			});
		}
	}

	public getUser(userId: string, teamId: string): User | null {
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.users.get(userId) || null;
	}

	public addChannel(data: IChannelData, createTeam = true) {
		const teamId = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]);
		if (!teamId) {
			return;
		}
		const team = this.teams.get(teamId);
		if (team) {
			const chan = team.channels.get(data.id);
			if (chan) {
				const oldChan = chan._clone();
				chan._patch(data);
				if (!this.startup.has(team.id)) {
					this.emit("changeChannel", oldChan, chan);
				}
			} else {
				const newChan = new Channel(this, data);
				team.channels.set(newChan.id, newChan);
				if (!this.startup.has(team.id)) {
					newChan.join().catch((err) => {}).then(() => {
						this.emit("addChannel", newChan);
					});
				}
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any
			this.web(teamId).team.info({ team: teamId }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addChannel(data, false);
				}
			});
		}
	}

	public getChannel(channelId: string, teamId: string): Channel | null {
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.channels.get(channelId) || null;
	}

	public addTeam(data: ITeamData) {
		const team = this.teams.get(data.id);
		if (team) {
			const oldTeam = team._clone();
			team._patch(data);
			if (!this.startup.has(team.id)) {
				this.emit("changeTeam", oldTeam, team);
			}
		} else {
			const newTeam = new Team(this, data);
			this.teams.set(newTeam.id, newTeam);
			if (!this.startup.has(newTeam.id)) {
				this.emit("addTeam", newTeam);
			}
		}
	}

	public getTeam(teamId: string): Team | null {
		return this.teams.get(teamId) || null;
	}

	public getOauthUrl(redirectUrl: string): string {
		if (!this.opts.events) {
			return "";
		}
		const cid = encodeURIComponent(this.opts.events.clientId);
		const url = encodeURIComponent(redirectUrl);
		const scope: string[] = [];
		return `https://slack.com/oath/v2/authorize?scope=${scope.join(",")}&client_id=${cid}&redirect_uri=${url}`;
	}

	private handleMessageEvent(data) {
		if (["channel_join", "channel_name", "message_replied"].includes(data.subtype)) {
			return;
		}
		if (data.bot_id) {
			// okay, we need to create the bot
			this.addUser(data);
		}
		const teamId = data.team_id;
		let userId = data.user || data.bot_id;
		const channelId = data.channel || data.item.channel;
		for (const tryKey of ["message", "previous_message"]) {
			if (data[tryKey]) {
				if (!userId) {
					userId = data[tryKey].user || data[tryKey].bot_id;
				}
			}
		}
		if (data.subtype === "message_changed") {
			// we do an edit
			const oldMessage = new Message(this, data.previous_message, teamId, channelId, userId);
			const newMessage = new Message(this, data.message, teamId, channelId, userId);
			this.emit("messageChanged", oldMessage, newMessage);
		} else if (data.subtype === "message_deleted") {
			// we do a message deletion
			const oldMessage = new Message(this, data.previous_message, teamId, channelId, userId);
			this.emit("messageDeleted", oldMessage);
		} else {
			const message = new Message(this, data, teamId, channelId, userId);
			this.emit("message", message);
		}
	}

	private getHtmlResponse(title: string, content: string): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<title>Slack OAuth token</title>
	<style>
		body {
			margin-top: 16px;
			text-align: center;
		}
	</style>
</head>
<body>
	<h4>${title}</h4>
	<h2>${content}</h2>
</body>
</html>`;
	}
}
