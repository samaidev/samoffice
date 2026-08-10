export namespace core {
	
	export class Comment {
	    id: string;
	    author: string;
	    content: string;
	    anchor?: string;
	
	    static createFrom(source: any = {}) {
	        return new Comment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.author = source["author"];
	        this.content = source["content"];
	        this.anchor = source["anchor"];
	    }
	}
	export class Warning {
	    level: string;
	    stage: string;
	    message: string;
	    path?: string;
	
	    static createFrom(source: any = {}) {
	        return new Warning(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.stage = source["stage"];
	        this.message = source["message"];
	        this.path = source["path"];
	    }
	}
	export class DocumentProtect {
	    enabled: boolean;
	    hash: string;
	
	    static createFrom(source: any = {}) {
	        return new DocumentProtect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.hash = source["hash"];
	    }
	}
	export class PageNumberConfig {
	    enabled: boolean;
	    format: string;
	    align?: string;
	    fontFamily?: string;
	    fontSize?: number;
	    fontColor?: string;
	    bold?: boolean;
	    italic?: boolean;
	    firstPageDifferent?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PageNumberConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.format = source["format"];
	        this.align = source["align"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.fontColor = source["fontColor"];
	        this.bold = source["bold"];
	        this.italic = source["italic"];
	        this.firstPageDifferent = source["firstPageDifferent"];
	    }
	}
	export class StyleDef {
	    name: string;
	    type: string;
	    parent?: string;
	    props?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new StyleDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.parent = source["parent"];
	        this.props = source["props"];
	    }
	}
	export class Meta {
	    title: string;
	    author?: string;
	    subject?: string;
	    description?: string;
	    createdAt?: string;
	    modifiedAt?: string;
	    language?: string;
	
	    static createFrom(source: any = {}) {
	        return new Meta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.author = source["author"];
	        this.subject = source["subject"];
	        this.description = source["description"];
	        this.createdAt = source["createdAt"];
	        this.modifiedAt = source["modifiedAt"];
	        this.language = source["language"];
	    }
	}
	export class Document {
	    meta: Meta;
	    blocks: any[];
	    comments?: Comment[];
	    styles?: StyleDef[];
	    pageNumber?: PageNumberConfig;
	    protect?: DocumentProtect;
	    warnings?: Warning[];
	    raw?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.meta = this.convertValues(source["meta"], Meta);
	        this.blocks = source["blocks"];
	        this.comments = this.convertValues(source["comments"], Comment);
	        this.styles = this.convertValues(source["styles"], StyleDef);
	        this.pageNumber = this.convertValues(source["pageNumber"], PageNumberConfig);
	        this.protect = this.convertValues(source["protect"], DocumentProtect);
	        this.warnings = this.convertValues(source["warnings"], Warning);
	        this.raw = source["raw"];
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

export namespace dict {
	
	export class Candidate {
	    word: string;
	    distance: number;
	    frequency: number;
	
	    static createFrom(source: any = {}) {
	        return new Candidate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.word = source["word"];
	        this.distance = source["distance"];
	        this.frequency = source["frequency"];
	    }
	}
	export class SpellError {
	    word: string;
	    lang: string;
	    start: number;
	    end: number;
	    suggest: string[];
	
	    static createFrom(source: any = {}) {
	        return new SpellError(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.word = source["word"];
	        this.lang = source["lang"];
	        this.start = source["start"];
	        this.end = source["end"];
	        this.suggest = source["suggest"];
	    }
	}

}

