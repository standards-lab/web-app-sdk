// The application SDK's event-stream parser: the bytes of a text/event-stream body to the events it
// dispatches, by the WHATWG HTML standard's "Parsing an event stream" and "Interpreting an event
// stream" (§9.2.5–9.2.6). It is internal: the client's stream reads a response through it, and
// package.json's exports leave it out.
/** An incremental parser of one event stream. `push` takes each chunk of the body's bytes as it
 * arrives, split anywhere, a UTF-8 sequence or a CRLF included, and returns the events its lines
 * complete; `end` takes the end of the body. One leading BOM is stripped. A line ends at CR, LF, or
 * CRLF. A blank line dispatches the event its fields built, unless its data is empty; a line that
 * begins with ":" is a comment; a line with no ":" is a field with an empty value; and one space
 * after the ":" is stripped from the value. Data lines join with "\n". An `id` holding NUL is
 * ignored, and the last id set carries to every later event, as an EventSource's lastEventId does,
 * until an `id` with an empty value clears it. */
export class EventStreamParser {
    #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    #textArrived = false;
    #unendedLine = "";
    #endedWithCR = false;
    #type = "";
    #data = "";
    #id = "";
    /** The reconnection time, in ms, that the stream's last valid `retry` field set; undefined when
     * none has. The client makes no reconnection, so it reads none, and the events carry none. */
    retry;
    /** The events that `bytes`, the body's next chunk, completes. */
    push(bytes) {
        return this.#text(this.#decoder.decode(bytes, { stream: true }));
    }
    /** The end of the body: any bytes the decoder holds are decoded, and the event a blank line never
     * ended, with the line that never ended, is discarded, as the standard says. Returns the events a
     * line end in that last text completes. */
    end() {
        const events = this.#text(this.#decoder.decode());
        this.#unendedLine = "";
        this.#type = "";
        this.#data = "";
        return events;
    }
    #text(chunk) {
        let text = chunk;
        if (!this.#textArrived && text.length > 0) {
            this.#textArrived = true;
            if (text.startsWith("\uFEFF"))
                text = text.slice(1);
        }
        if (text.length > 0) {
            if (this.#endedWithCR && text.startsWith("\n"))
                text = text.slice(1);
            this.#endedWithCR = false;
        }
        const events = [];
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c !== "\r" && c !== "\n")
                continue;
            this.#field(this.#unendedLine + text.slice(start, i), events);
            this.#unendedLine = "";
            if (c === "\r") {
                if (i + 1 === text.length)
                    this.#endedWithCR = true;
                else if (text[i + 1] === "\n")
                    i++;
            }
            start = i + 1;
        }
        this.#unendedLine += text.slice(start);
        return events;
    }
    #field(line, events) {
        if (line === "") {
            this.#dispatch(events);
            return;
        }
        if (line.startsWith(":"))
            return;
        const colon = line.indexOf(":");
        const name = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" "))
            value = value.slice(1);
        switch (name) {
            case "event":
                this.#type = value;
                break;
            case "data":
                this.#data += `${value}\n`;
                break;
            case "id":
                if (!value.includes("\0"))
                    this.#id = value;
                break;
            case "retry":
                if (/^[0-9]+$/.test(value))
                    this.retry = Number(value);
                break;
        }
    }
    #dispatch(events) {
        if (this.#data !== "") {
            const event = {
                type: this.#type || "message",
                data: this.#data.slice(0, -1),
            };
            if (this.#id !== "")
                event.id = this.#id;
            events.push(event);
        }
        this.#type = "";
        this.#data = "";
    }
}
