/*
Copyright 2020 soru-slack-client
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { RTMClient } from "@slack/rtm-api";
import { WebClient, WebAPICallResult } from "@slack/web-api";
import { SlackEventAdapter } from "@slack/events-api/dist/adapter";
import { EventEmitter } from "events";
import { IUserData, User } from "./user";
import { IBotData, Bot } from "./bot";
import { IChannelData, Channel } from "./channel";
import { ITeamData, Team } from "./team";
import { Message } from "./message";
import { Reaction } from "./reaction";
import { Logger } from "../logger";
import { Util } from "../util";
import { Buffer } from "buffer";
import * as ua from "useragent-generator";
import * as express from "express";

const log = new Logger("Client");

export interface IStoreToken {
	token: string;
	userId: string;
	teamId: string;
}

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
		storeToken: (t: IStoreToken) => Promise<void>,
		getTokens: () => Promise<IStoreToken[]>,
	};
	separator?: string;
}

const RECONNECT_PAUSE = 15000;

export class Client extends EventEmitter {
	public tokens: Map<string, string> = new Map();
	public teams: Map<string, Team> = new Map();
	public users: Map<string, User> = new Map();
	public separator: string;
	private webMap: Map<string, WebClient> = new Map();
	private rtmMap: Map<string, RTMClient> = new Map();
	private events: SlackEventAdapter | null = null;
	private startup: Set<string> = new Set();
	private shouldDisconnect: boolean = false;
	constructor(private opts: IClientOpts) {
		super();
		this.separator = opts.separator || "-";
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
		log.info("Disconnecting...");
		this.shouldDisconnect = true;
		for (const [, rtm] of this.rtmMap) {
			try {
				const curState = rtm["stateMachine"].getCurrentState(); // tslint:disable-line no-string-literal
				if (["connecting", "connected"].includes(curState)) {
					await rtm.disconnect();
				}
			} catch (err) {
				log.error("Error disconnecting from RTM:", err);
			}
		}
		if (this.events) {
			try {
				await this.events.stop();
			} catch (err) {
				log.error("Failed to disconnect from events API:", err);
			}
		}
	}

	public async connect() {
		log.info("Connecting...");
		this.shouldDisconnect = false;
		if (this.opts.token) {
			await this.addToken(this.opts.token);
		}
		if (this.opts.events) {
			await this.connectToEventsApi();
		}
		this.emit("connected");
	}

	public async addToken(token: string, teamId: string = "", userId: string = "") {
		log.info(`Adding token for team=${teamId} and user=${userId}...`);
		const useragent = ua.chrome("79.0.3945.117");
		// tslint:disable-next-line no-any
		const webHeaders: any = this.opts.cookie ? { headers: {
			"Cookie": `d=${encodeURIComponent(decodeURIComponent(this.opts.cookie))}`,
			"User-Agent": useragent,
		}} : {};
		const web = new WebClient(token, webHeaders);
		if (teamId) {
			this.startup.add(teamId);
			this.webMap.set(teamId, web);
			this.tokens.set(teamId, token);
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
			if (this.opts.events) {
				await this.opts.events.storeToken({
					token,
					teamId,
					userId,
				});
			}
			return;
		}
		log.verbose("connecting to RTM...");
		// tslint:disable-next-line no-any
		const rtmHeaders: any = this.opts.cookie ? { tls: { headers: {
			"Cookie": `d=${encodeURIComponent(decodeURIComponent(this.opts.cookie))}`,
			"User-Agent": useragent,
		}}} : {};
		const rtm = new RTMClient(token, rtmHeaders);
		const reconnect = async () => {
			const curState = rtm["stateMachine"].getCurrentState(); // tslint:disable-line no-string-literal
			if (["connecting", "connected"].includes(curState)) {
				await rtm.disconnect();
			}
			log.info("RTM client got disconnected, reconnecting...");
			setTimeout(async () => {
				try {
					const newCurState = rtm["stateMachine"].getCurrentState(); // tslint:disable-line no-string-literal
					if (["disconnected"].includes(newCurState)) {
						await rtm.start();
					}
					log.info("Reconnected!");
				} catch (err) {
					log.error("Failed to re-start RTM client", err);
					this.emit("disconnected");
				}
			}, RECONNECT_PAUSE);
		};
		return new Promise(async (resolve, reject) => {
			rtm.once("unable_to_rtm_start", async (err) => {
				log.debug("RTM event: unable_to_rtm_start");
				if (err.data && err.data.error === "not_allowed_token_type" && this.opts.events) {
					this.opts.noRtm = true;
					if (this.opts.events) {
						await this.opts.events.storeToken({
							token,
							teamId,
							userId,
						});
					}
					resolve();
				} else {
					log.error("Failed to start rtm client", err);
					reject(err);
				}
			});

			rtm.on("goodbye", async () => {
				log.debug("RTM event: goodbye");
				if (!this.shouldDisconnect) {
					await reconnect();
				}
			});

			rtm.on("disconnected", async () => {
				log.debug("RTM event: disconnected");
				if (!this.shouldDisconnect) {
					await reconnect();
				}
			});

			rtm.on("authenticated", async (data) => {
				log.debug("RTM event: authenticated");
				teamId = data.team.id as string;
				this.startup.add(teamId);
				this.rtmMap.set(teamId, rtm);
				this.webMap.set(teamId, web);
				this.tokens.set(teamId, token);
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
				if (this.opts.events) {
					await this.opts.events.storeToken({
						token,
						teamId,
						userId,
					});
				}
				this.startup.delete(teamId);
			});

			rtm.on("ready", () => {
				log.debug("RTM event: ready");
				resolve();
			});

			rtm.on("error", (error) => {
				log.warn("RTM API error", error);
			});

			for (const ev of ["bot_added", "bot_changed"]) {
				rtm.on(ev, (data) => {
					log.debug("RTM event: bot_added/changed");
					data.bot.team_id = teamId;
					this.addBot(data.bot);
				});
			}

			for (const ev of ["team_profile_change", "team_pref_change"]) {
				rtm.on(ev, async () => {
					log.debug("RTM event: team_profile/pref_change");
					const ret = await this.web(teamId).team.info({
						team: teamId,
					});
					if (!ret || !ret.ok || !ret.team) {
						return;
					}
					this.addTeam(ret.team as ITeamData);
				});
			}

			rtm.on("user_typing", (data) => {
				log.debug("RTM event: user_typing");
				log.silly(data);
				const channel = this.getChannel(data.channel, teamId);
				const user = this.getUser(data.user || data.bot_id, teamId);
				if (channel && user) {
					this.emit("typing", channel, user);
				}
			});

			rtm.on("presence_change", (data) => {
				log.debug("RTM event: presence_change");
				const user = this.getUser(data.user || data.bot_id, teamId);
				if (user) {
					this.emit("presenceChange", user, data.presence);
				}
			});

			if (!this.opts.events) {
				for (const ev of ["im_created", "channel_created", "channel_rename", "group_joined", "group_rename"]) {
					rtm.on(ev, (data) => {
						log.debug("RTM event: im/channel/group_created/rename");
						data.channel.team_id = teamId;
						this.addChannel(data.channel);
					});
				}

				for (const ev of ["team_join", "user_change"]) {
					rtm.on(ev, (data) => {
						log.debug("RTM event: team_join/user_change");
						data.user.team_id = teamId;
						this.addUser(data.user);
					});
				}

				rtm.on("message", async (data) => {
					log.debug("RTM event: message");
					data.team_id = teamId;
					await this.handleMessageEvent(data);
				});

				rtm.on("reaction_added", async (data) => {
					log.debug("RTM event: reaction_added");
					log.silly(data);
					data.team_id = teamId;
					const reaction = await Reaction.construct(this, data);
					this.emit("reactionAdded", reaction);
				});

				rtm.on("reaction_removed", async (data) => {
					log.debug("RTM event: reaction_removed");
					log.silly(data);
					data.team_id = teamId;
					const reaction = await Reaction.construct(this, data);
					this.emit("reactionRemoved", reaction);
				});

				rtm.on("team_rename", (data) => {
					log.debug("RTM event: team_rename");
					if (this.teams.size <= 1) {
						this.addTeam({
							id: teamId,
							name: data.name,
						});
					}
				});

				rtm.on("member_joined_channel", (data) => {
					log.debug("RTM event: member_joined_channel");
					const userObj = this.getUser(data.user, teamId);
					const chanObj = this.getChannel(data.channel, teamId);
					if (userObj && chanObj) {
						chanObj.members.set(userObj.id, userObj);
						this.emit("memberJoinedChannel", userObj, chanObj);
					}
				});

				rtm.on("member_left_channel", (data) => {
					log.debug("RTM event: member_left_channel");
					const userObj = this.getUser(data.user, teamId);
					const chanObj = this.getChannel(data.channel, teamId);
					if (userObj && chanObj) {
						chanObj.members.delete(userObj.id);
						this.emit("memberLeftChannel", userObj, chanObj);
					}
				});
			}

			try {
				await rtm.start();
				log.info("RTM connected");
			} catch (err) {
				log.error("Failed to start rtm client", err);
				reject(err);
			}
		});
	}

	public async connectToEventsApi() {
		if (!this.opts.events) {
			return;
		}
		log.info("Connecting to events api...");
		this.events = new SlackEventAdapter(this.opts.events.signingSecret, {
			includeBody: true,
		});
		this.opts.events.express.app.use(this.opts.events.express.path + "/events", this.events.requestListener());

		const appId = this.opts.events.appId;
		this.opts.events.express.app.get(`${this.opts.events.express.path}/oauth/${encodeURIComponent(appId)}`,
			async (req: express.Request, res: express.Response) => {
			log.debug("New oauth request");
			const data = await (new WebClient()).oauth.v2.access({
				client_id: this.opts.events!.clientId,
				client_secret: this.opts.events!.clientSecret,
				code: req.query.code,
			});
			if (data.app_id !== appId) {
				log.silly("Not for our app, ignoring...");
				return;
			}
			const STATUS_FORBIDDEN = 403;
			if (!data || !data.ok) {
				log.debug("Failed to get oauth token", data);
				res.status(STATUS_FORBIDDEN).send(this.getHtmlResponse("Failed to get OAuth token",
					encodeURIComponent(data.error as string)));
				return;
			}
			log.debug("Successfully verified oauth");
			const teamId = (data.team as any).id; // tslint:disable-line no-any
			await this.addToken((data as any).access_token, teamId, (data as any).bot_user_id); // tslint:disable-line no-any

			const newTeam = this.teams.get(teamId);
			if (newTeam) {
				this.startup.add(teamId);
				await newTeam.joinAllChannels();
				this.startup.delete(teamId);
			}
			res.send(this.getHtmlResponse("Successfully added slack bot to team", ""));
		});

		this.events.on("app_uninstalled", async (data) => {
			if (data.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: app_uninstalled");
			const teamId = data.team_id;
			const rtm = this.rtmMap.get(teamId);
			if (rtm) {
				await rtm.disconnect();
			}
			this.webMap.delete(teamId);
			this.rtmMap.delete(teamId);
			this.tokens.delete(teamId);
			this.teams.delete(teamId);
			this.users.delete(teamId);
		});

		for (const ev of ["im_created", "channel_created", "channel_rename", "group_joined", "group_rename"]) {
			this.events.on(ev, (data, evt) => {
				if (evt.api_app_id !== appId) {
					return;
				}
				log.debug("Events event: im/channel/group_created/rename");
				data.channel.team_id = evt.team_id;
				this.addChannel(data.channel);
			});
		}

		for (const ev of ["team_join", "user_change"]) {
			this.events.on(ev, (data, evt) => {
				if (evt.api_app_id !== appId) {
					return;
				}
				log.debug("Events event: team_join/user_change");
				data.user.team_id = evt.team_id;
				this.addUser(data.user);
			});
		}

		this.events.on("message", async (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: message");
			data.team_id = evt.team_id;
			await this.handleMessageEvent(data);
		});

		this.events.on("reaction_added", async (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: reaction_added");
			data.team_id = evt.team_id;
			const reaction = await Reaction.construct(this, data);
			this.emit("reactionAdded", reaction);
		});

		this.events.on("reaction_removed", async (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: reaction_removed");
			data.team_id = evt.team_id;
			const reaction = await Reaction.construct(this, data);
			this.emit("reactionRemoved", reaction);
		});

		this.events.on("team_rename", (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: team_rename");
			this.addTeam({
				id: evt.team_id,
				name: data.name,
			});
		});

		this.events.on("member_joined_channel", (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: member_joined_channel");
			const userObj = this.getUser(data.user, evt.team_id);
			const chanObj = this.getChannel(data.channel, evt.team_id);
			if (userObj && chanObj) {
				chanObj.members.set(userObj.id, userObj);
				this.emit("memberJoinedChannel", userObj, chanObj);
			}
		});

		this.events.on("member_left_channel", (data, evt) => {
			if (evt.api_app_id !== appId) {
				return;
			}
			log.debug("Events event: member_left_channel");
			const userObj = this.getUser(data.user, evt.team_id);
			const chanObj = this.getChannel(data.channel, evt.team_id);
			if (userObj && chanObj) {
				chanObj.members.delete(userObj.id);
				this.emit("memberLeftChannel", userObj, chanObj);
			}
		});

		this.events.on("error", (error) => {
			log.warn("Events API error", error);
		});

		// alright, and don't forget to load the tokens!
		const tokens = await this.opts.events.getTokens();
		for (const t of tokens) {
			await this.addToken(t.token, t.teamId, t.userId);
		}
	}

	public addUser(data: IUserData, createTeam = true) {
		const team = this.teams.get(data.team_id);
		if (team) {
			const user = team.users.get(data.id);
			if (user) {
				const oldUser = user._clone();
				user._patch(data);
				if (!this.startup.has(team.id)) {
					this.emit("changeUser", oldUser, user);
				}
			} else {
				const newUser = new User(this, data);
				team.users.set(newUser.id, newUser);
				if (this.rtmMap.has(team.id)) {
					// tslint:disable-next-line no-floating-promises
					this.rtm(team.id).subscribePresence([newUser.id]);
				}
				if (!this.startup.has(team.id)) {
					this.emit("addUser", newUser);
				}
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any no-floating-promises
			this.web(data.team_id).team.info({ team: data.team_id }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addUser(data, false);
				}
			});
		}
	}

	public getUser(userId: string, teamId?: string): User | null {
		if (!teamId) {
			[teamId, userId] = userId.split(this.separator);
		}
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		{
			const u = team.users.get(userId);
			if (u) {
				return u;
			}
		}
		// does the user exist on a fake team?
		for (const [, t] of this.teams) {
			if (t.fakeId === teamId) {
				const u = t.users.get(userId);
				if (u) {
					return u;
				}
			}
		}
		// does the user exist on *any* team?
		for (const [, t] of this.teams) {
			const u = t.users.get(userId);
			if (u) {
				return u;
			}
		}
		return null;
	}

	public addBot(data: IBotData, createTeam = true) {
		const team = this.teams.get(data.team_id);
		if (team) {
			const bot = team.bots.get(data.bot_id);
			if (bot) {
				const oldBot = bot._clone();
				bot._patch(data);
				if (!this.startup.has(team.id)) {
					this.emit("changeBot", oldBot, bot);
				}
			} else {
				const newBot = new Bot(this, data);
				team.bots.set(newBot.id, newBot);
				if (!this.startup.has(team.id)) {
					this.emit("addBot", newBot);
				}
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any no-floating-promises
			this.web(data.team_id).team.info({ team: data.team_id }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addBot(data, false);
				}
			});
		}
	}

	public getBot(botId: string, teamId?: string): Bot | null {
		if (!teamId) {
			[teamId, botId] = botId.split(this.separator);
		}
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.bots.get(botId) || null;
	}

	public getUserOrBot(id: string, teamId?: string): User | Bot | null {
		if (!teamId) {
			[teamId, id] = id.split(this.separator);
		}
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.users.get(id) || team.bots.get(id) || null;
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
					const token = this.tokens.get(team.id) || "";
					if (token.startsWith("xoxb")) {
						// tslint:disable-next-line no-floating-promises
						newChan.join().catch((err) => {}).then(() => {
							this.emit("addChannel", newChan);
						});
					} else {
						this.emit("addChannel", newChan);
					}
				}
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any no-floating-promises
			this.web(teamId).team.info({ team: teamId }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addChannel(data, false);
				}
			});
		}
	}

	public getChannel(channelId: string, teamId?: string): Channel | null {
		if (!teamId) {
			[teamId, channelId] = channelId.split(this.separator);
		}
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

	public async downloadFile(url: string): Promise<Buffer> {
		let token: string | undefined;
		for (const [, user] of this.users) {
			let otherDomain = user.team.id;
			let otherId = user.team.id;
			if (user.team.fakeId) {
				otherId = user.team.fakeId;
				const t = this.teams.get(user.team.fakeId);
				if (t) {
					otherDomain = t.domain;
				}
			}
			if (url.includes(user.team.domain) || url.includes(user.team.id)
				|| url.includes(otherId) || url.includes(otherDomain)) {
				token = this.tokens.get(user.team.id);
				break;
			}
		}
		if (!token) {
			return await Util.DownloadFile(url);
		} else {
			return await Util.DownloadFile(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
		}
	}

	public async getChannelAndAuthor(data): Promise<{channel: Channel, author: User | Bot}> {
		const teamId = data.team_id;
		const team = this.teams.get(teamId);
		if (team && team.partial) {
			await team.load();
		}
		let sourceTeamId = teamId;
		if (data.source_team && data.source_team !== teamId) {
			// we have a message from an external team
			sourceTeamId = data.source_team;
			let sourceTeam = this.teams.get(sourceTeamId);
			if (!sourceTeam) {
				this.startup.add(sourceTeamId);
				this.addTeam({
					id: sourceTeamId,
					fakeId: teamId,
				});
				sourceTeam = this.teams.get(sourceTeamId);
				this.startup.delete(sourceTeamId);
			}
			if (!sourceTeam) {
				throw new Error("Couldn't create source team");
			}
			if (sourceTeam.partial) {
				await sourceTeam.load();
			}
		}
		const channelId = data.channel || data.item.channel;
		const channel = this.getChannel(channelId, teamId);
		if (!channel) {
			throw new Error("Channel not found");
		}
		let author: User | Bot | null = null;
		let userId = data.user;
		let botId = data.bot_id;
		for (const tryKey of ["message", "previous_message"]) {
			if (data[tryKey]) {
				if (!userId) {
					userId = data[tryKey].user;
				}
				if (!botId) {
					botId = data[tryKey].bot_id;
				}
			}
		}
		if (userId) {
			if (this.getUser(userId, sourceTeamId)) {
				author = this.getUser(userId, sourceTeamId);
			} else {
				this.addUser({
					id: userId,
					team_id: sourceTeamId,
				});
				author = this.getUser(userId, sourceTeamId);
			}
		} else if (botId) {
			// okay, we need to create the bot
			const botData = Object.assign({}, data, {
				bot_id: botId,
				team_id: sourceTeamId,
			});
			this.addBot(botData);
			author = this.getBot(botId, sourceTeamId);
		}
		if (!author) {
			throw new Error("User or bot not found");
		}
		return { channel, author };
	}

	private async handleMessageEvent(data) {
		if (["channel_join", "channel_name", "group_join", "group_name", "message_replied"].includes(data.subtype)) {
			return;
		}
		log.silly("Processing message with data", data);
		const { channel, author } = await this.getChannelAndAuthor(data);
		if (data.subtype === "message_changed") {
			// we do an edit
			const oldMessage = new Message(this, data.previous_message, channel, author);
			const newMessage = new Message(this, data.message, channel, author);
			this.emit("messageChanged", oldMessage, newMessage);
		} else if (data.subtype === "message_deleted") {
			// we do a message deletion
			const oldMessage = new Message(this, data.previous_message, channel, author);
			this.emit("messageDeleted", oldMessage);
		} else {
			const message = new Message(this, data, channel, author);
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
