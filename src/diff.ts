export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

const tokensOf = (text: string) => text.match(/\s+|[^\s]+/gu) ?? [];

const lcsTable = (before: string[], after: string[]) => {
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
};

const merged = (parts: DiffPart[]) =>
  parts.reduce<DiffPart[]>((all, part) => {
    const last = all.at(-1);
    if (last != null && last.kind === part.kind) {
      return [
        ...all.slice(0, -1),
        { kind: last.kind, text: last.text + part.text },
      ];
    }

    return [...all, part];
  }, []);

export const wordDiff = (before: string, after: string): DiffPart[] => {
  const one = tokensOf(before);
  const other = tokensOf(after);
  const table = lcsTable(one, other);
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < one.length && j < other.length) {
    if (one[i] === other[j]) {
      parts.push({ kind: "same", text: one[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      parts.push({ kind: "removed", text: one[i] });
      i += 1;
    } else {
      parts.push({ kind: "added", text: other[j] });
      j += 1;
    }
  }

  one.slice(i).forEach((text) => parts.push({ kind: "removed", text }));
  other.slice(j).forEach((text) => parts.push({ kind: "added", text }));
  return merged(parts);
};
