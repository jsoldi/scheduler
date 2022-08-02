import * as util from 'util';
import * as child_process from 'child_process';
const exec = util.promisify(child_process.exec);
export class Entry {
    constructor(name, time, cmd) {
        this.name = name;
        this.time = time;
        this.cmd = cmd;
    }
    static parse(name, hour, cmd) {
        const parts = hour.split(':');
        const date = new Date();
        date.setHours(parseInt(parts[0]), parseInt(parts[1]));
        return new Entry(name, date, cmd);
    }
    static datesMatchHourAndMinute(date1, date2) {
        if (date1 == null)
            return date2 == null;
        if (date2 == null)
            return date1 == null;
        return date1.getHours() === date2.getHours() && date1.getMinutes() === date2.getMinutes();
    }
    forDate(newDate) {
        let dateCopy = new Date(newDate);
        dateCopy.setHours(this.time.getHours(), this.time.getMinutes());
        return new Entry(this.name, dateCopy, this.cmd);
    }
    forToday() {
        return this.forDate(new Date());
    }
    matchesHourAndMinute(date) {
        return Entry.datesMatchHourAndMinute(this.time, date);
    }
    timeString() {
        return this.time.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    static truncate(str, maxLength = Entry.MAX_LINE_LENGTH) {
        if (str.length <= maxLength)
            return str;
        return str.substring(0, maxLength - 1) + '…';
    }
    toString(maxLength = Entry.MAX_LINE_LENGTH) {
        return Entry.truncate(`${this.timeString()} | ${this.name} | ${this.cmd}`, maxLength);
    }
    minuteOfDay() {
        return this.time.getHours() * 60 + this.time.getMinutes();
    }
    moveBy(minutes) {
        let date = new Date(this.time.getTime() + minutes * 60000);
        return new Entry(this.name, date, this.cmd);
    }
    appendCmd(cmd) {
        return new Entry(this.name, this.time, `${this.cmd} ${cmd}`);
    }
    async run() {
        if (Entry.runningItems.has(this.toString()))
            throw new Error(`Item ${this.name} is already running.`);
        try {
            Entry.runningItems.add(this.toString());
            const { stdout, stderr } = await exec(this.cmd);
            if (stdout != null)
                return stdout;
            else
                throw new Error(stderr);
        }
        finally {
            Entry.runningItems.delete(this.toString());
        }
    }
}
Entry.runningItems = new Set();
Entry.MAX_LINE_LENGTH = 80;
export class Schedule {
    constructor(entries, entryFilter = () => true) {
        this.entries = entries;
        this.entryFilter = entryFilter;
    }
    filter(filter) {
        return new Schedule(this.entries, (...args) => this.entryFilter(...args) && filter(...args));
    }
    static delay(ms) {
        return new Promise(a => setTimeout(a, ms));
    }
    forDate(date) {
        return new Schedule(this.entries.map(e => e.forDate(date)));
    }
    forToday() {
        return new Schedule(this.entries.map(e => e.forToday()));
    }
    getCurrent() {
        let now = new Date();
        for (let e of this.entries) {
            if (e.matchesHourAndMinute(now))
                return e;
        }
    }
    *inMinute(minute) {
        for (let e of this.entries) {
            if (e.matchesHourAndMinute(minute))
                yield e;
        }
    }
    static async *minuteLoop() {
        let prev = null;
        while (true) {
            let curr = new Date();
            if (!Entry.datesMatchHourAndMinute(prev, curr)) {
                prev = curr;
                yield curr;
            }
            await Schedule.delay(Schedule.wait_time);
        }
    }
    async *waitForAll() {
        for await (let minute of Schedule.minuteLoop()) {
            for (let entry of this.inMinute(minute))
                yield [entry, minute];
        }
    }
    toString(lineLength = Entry.MAX_LINE_LENGTH) {
        let entries = [...this.entries];
        entries.sort((a, b) => a.minuteOfDay() - b.minuteOfDay());
        return entries.map(e => e.toString(lineLength)).join('\n');
    }
    moveBy(minutes) {
        return new Schedule(this.entries.map(e => e.moveBy(minutes)));
    }
    async run(acceptEntry = () => { }, rejectEntry = () => { }) {
        for await (let [entry, date] of this.waitForAll()) {
            if (this.entryFilter(entry, date))
                entry.run().then(acceptEntry, rejectEntry);
        }
    }
}
Schedule.wait_time = 5000;
