export namespace db {
	
	export class FileOfferRecord {
	    transferId: string;
	    senderId: string;
	    senderHostname: string;
	    senderNick: string;
	    senderIp: string;
	    targetHostname: string;
	    fileName: string;
	    fileSize: number;
	    status: string;
	    savePath: string;
	    timestamp: number;
	
	    static createFrom(source: any = {}) {
	        return new FileOfferRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.transferId = source["transferId"];
	        this.senderId = source["senderId"];
	        this.senderHostname = source["senderHostname"];
	        this.senderNick = source["senderNick"];
	        this.senderIp = source["senderIp"];
	        this.targetHostname = source["targetHostname"];
	        this.fileName = source["fileName"];
	        this.fileSize = source["fileSize"];
	        this.status = source["status"];
	        this.savePath = source["savePath"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class MessageRecord {
	    id: string;
	    senderId: string;
	    senderHostname: string;
	    senderNick: string;
	    senderIp: string;
	    targetHostname: string;
	    content: string;
	    timestamp: number;
	
	    static createFrom(source: any = {}) {
	        return new MessageRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.senderId = source["senderId"];
	        this.senderHostname = source["senderHostname"];
	        this.senderNick = source["senderNick"];
	        this.senderIp = source["senderIp"];
	        this.targetHostname = source["targetHostname"];
	        this.content = source["content"];
	        this.timestamp = source["timestamp"];
	    }
	}

}

export namespace main {
	
	export class CombinedPeer {
	    id: string;
	    nickname: string;
	    ip: string;
	    hostname: string;
	    isHost: boolean;
	    joinedAt: number;
	    isOnline: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CombinedPeer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.nickname = source["nickname"];
	        this.ip = source["ip"];
	        this.hostname = source["hostname"];
	        this.isHost = source["isHost"];
	        this.joinedAt = source["joinedAt"];
	        this.isOnline = source["isOnline"];
	    }
	}
	export class InitialState {
	    myPeer: network.Peer;
	    isHost: boolean;
	    serverAddr: string;
	    peers: CombinedPeer[];
	
	    static createFrom(source: any = {}) {
	        return new InitialState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.myPeer = this.convertValues(source["myPeer"], network.Peer);
	        this.isHost = source["isHost"];
	        this.serverAddr = source["serverAddr"];
	        this.peers = this.convertValues(source["peers"], CombinedPeer);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace network {
	
	export class Peer {
	    id: string;
	    nickname: string;
	    ip: string;
	    hostname: string;
	    isHost: boolean;
	    joinedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Peer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.nickname = source["nickname"];
	        this.ip = source["ip"];
	        this.hostname = source["hostname"];
	        this.isHost = source["isHost"];
	        this.joinedAt = source["joinedAt"];
	    }
	}

}

