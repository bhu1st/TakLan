export namespace main {
	
	export class InitialState {
	    myPeer: network.Peer;
	    isHost: boolean;
	    serverAddr: string;
	    peers: network.Peer[];
	
	    static createFrom(source: any = {}) {
	        return new InitialState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.myPeer = this.convertValues(source["myPeer"], network.Peer);
	        this.isHost = source["isHost"];
	        this.serverAddr = source["serverAddr"];
	        this.peers = this.convertValues(source["peers"], network.Peer);
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

