import * as util from 'util';
import * as child_process from 'child_process';
const exec = util.promisify(child_process.exec);

export type Hour = `${number}${number}:${number}${number}`;

export class Entry {
    private static readonly runningItems = new Set<string>();
    public static readonly MAX_LINE_LENGTH = 80;

    constructor(public readonly name: string, public readonly time: Date, public readonly cmd: string) { }

    static parse(name: string, hour: Hour, cmd: string) {
        const parts = hour.split(':');
        const date = new Date();
        date.setHours(parseInt(parts[0]), parseInt(parts[1]));
        return new Entry(name, date, cmd);
    }

    static datesMatchHourAndMinute(date1: Date | null, date2: Date | null) {
        if (date1 == null)
            return date2 == null;

        if (date2 == null)
            return date1 == null;

        return date1.getHours() === date2.getHours() && date1.getMinutes() === date2.getMinutes();
    }

    forDate(newDate: Date) {
        let dateCopy = new Date(newDate);
        dateCopy.setHours(this.time.getHours(), this.time.getMinutes());
        return new Entry(this.name, dateCopy, this.cmd);
    }

    forToday() {
        return this.forDate(new Date());
    }

    matchesHourAndMinute(date: Date) {
        return Entry.datesMatchHourAndMinute(this.time, date);
    }

    timeString() {
        return this.time.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    public static truncate(str: string, maxLength: number = Entry.MAX_LINE_LENGTH) {
        if (str.length <= maxLength)
            return str;

        return str.substring(0, maxLength - 1) + '…';
    }

    toString(maxLength: number = Entry.MAX_LINE_LENGTH) {
        return Entry.truncate(`${this.timeString()} | ${this.name} | ${this.cmd}`, maxLength);
    }

    minuteOfDay() {
        return this.time.getHours() * 60 + this.time.getMinutes();
    }

    moveBy(minutes: number) {
        let date = new Date(this.time.getTime() + minutes * 60000);
        return new Entry(this.name, date, this.cmd);
    }

    appendCmd(cmd: string) {
        return new Entry(this.name, this.time, `${this.cmd} ${cmd}`);
    }

    async run() {
        if (Entry.runningItems.has(this.toString()))
            throw new Error(`Item ${this.name} is already running.`);

        try {
            Entry.runningItems.add(this.toString());
            const { stdout, stderr } = await exec(this.cmd);

            if (stdout != null)
                return stdout as string;
            else
                throw new Error(stderr as string);
        }
        finally {
            Entry.runningItems.delete(this.toString());
        }
    }
}

type EntryFilter = (entry: Entry, date: Date) => boolean;

export class Schedule {
    private static readonly wait_time = 5000;

    constructor(public readonly entries: Entry[], public readonly entryFilter: EntryFilter = () => true) { }

    public filter(filter: EntryFilter) {
        return new Schedule(this.entries, (...args) => this.entryFilter(...args) && filter(...args));
    }

    static delay(ms: number) {
        return new Promise(a => setTimeout(a, ms));
    }

    public forDate(date: Date) {
        return new Schedule(this.entries.map(e => e.forDate(date)));
    }

    public forToday() {
        return new Schedule(this.entries.map(e => e.forToday()));
    }

    getCurrent() {
        let now = new Date();

        for (let e of this.entries) {
            if (e.matchesHourAndMinute(now))
                return e;
        }
    }

    * inMinute(minute: Date) {
        for (let e of this.entries) {
            if (e.matchesHourAndMinute(minute))
                yield e;
        }
    }

    static async * minuteLoop() {
        let prev: Date | null = null;

        while (true) {
            let curr = new Date();

            if (!Entry.datesMatchHourAndMinute(prev, curr)) {
                prev = curr;
                yield curr;
            }

            await Schedule.delay(Schedule.wait_time);
        }
    }

    async * waitForAll(): AsyncGenerator<[Entry, Date]> {
        for await (let minute of Schedule.minuteLoop()) {
            for (let entry of this.inMinute(minute)) 
                yield [entry, minute];
        }
    }

    toString(lineLength: number = Entry.MAX_LINE_LENGTH) {
        let entries = [...this.entries];
        entries.sort((a, b) => a.minuteOfDay() - b.minuteOfDay());
        return entries.map(e => e.toString(lineLength)).join('\n');
    }

    moveBy(minutes: number) {
        return new Schedule(this.entries.map(e => e.moveBy(minutes)));
    }

    async run(acceptEntry: (result: string) => void = () => { }, rejectEntry: (error: Error) => void = () => { }) {
        for await (let [entry, date] of this.waitForAll()) {
            if (this.entryFilter(entry, date)) 
                entry.run().then(acceptEntry, rejectEntry);
        }
    }
}
