export const chunkArray = (items, size) => {
    if (size <= 0)
        return [items];
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};
export const toIsoDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid date: ${value}`);
    }
    return date.toISOString().slice(0, 10);
};
export const addDays = (isoDate, days) => {
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid date: ${isoDate}`);
    }
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};
export const diffDays = (fromIso, toIso) => {
    const from = new Date(`${fromIso}T00:00:00Z`);
    const to = new Date(`${toIso}T00:00:00Z`);
    const diffMs = to.getTime() - from.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};
