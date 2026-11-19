import { StringUtils } from '../common/utils/string-utils';

export class ClauseCreator {
    /**
     * Escapes a value for use between single quotes. A NUL character (some taggers write them) would end the SQL text
     * early, so it is written as char(0) outside the quotes, which keeps the value exact.
     */
    public static escapeQuotes(sourceString: string): string {
        return StringUtils.replaceAll(StringUtils.replaceAll(sourceString, `'`, `''`), '\0', `' || char(0) || '`);
    }

    /**
     * Joins conditions with OR as a balanced tree. A flat chain of more than 1000 ORs is too deep for SQLite ("Expression
     * tree is too large"), which happened when playing more than about 1000 selected artists or genres.
     */
    public static joinWithOr(conditions: string[], groupSize: number = 100): string {
        return ClauseCreator.joinBalanced(conditions, 'OR', groupSize);
    }

    /** Joins conditions with AND or OR as a balanced tree (see joinWithOr). */
    public static joinBalanced(conditions: string[], operator: 'AND' | 'OR', groupSize: number = 100): string {
        const size: number = Number.isFinite(groupSize) ? Math.max(2, Math.floor(groupSize)) : 100;

        if (conditions.length <= size) {
            return conditions.join(` ${operator} `);
        }

        const groups: string[] = [];

        for (let i = 0; i < conditions.length; i += size) {
            groups.push(`(${conditions.slice(i, i + size).join(` ${operator} `)})`);
        }

        return ClauseCreator.joinBalanced(groups, operator, size);
    }

    /**
     * Escapes a value for use inside a LIKE pattern followed by ESCAPE '\\': without it, an artist named "AC_DC" also
     * matches "AC/DC" and "ACXDC", and one named "100%" matches everything that starts with "100".
     * Quotes are escaped too, so the result can go straight between single quotes.
     */
    public static escapeLike(value: string): string {
        return ClauseCreator.escapeQuotes(value.replace(/[\\%_]/g, (character: string) => `\\${character}`));
    }

    public static createTextInClause(columnName: string, clauseItems: string[]): string {
        const quotedClauseItems: string[] = clauseItems.map((item) => `'` + ClauseCreator.escapeQuotes(item) + `'`);
        const commaSeparatedItems: string = quotedClauseItems.join(',');

        return `${columnName} IN (${commaSeparatedItems})`;
    }

    public static createNumericInClause(columnName: string, clauseItems: number[]): string {
        const commaSeparatedItems: string = clauseItems.join(',');

        return `${columnName} IN (${commaSeparatedItems})`;
    }

    public static createOrLikeClause(columnName: string, clauseItems: string[], delimiter: string): string {
        let orLikeClause: string = '';

        orLikeClause += ' (';

        const orClauses: string[] = [];

        for (const clauseItem of clauseItems) {
            if (StringUtils.isNullOrWhiteSpace(clauseItem)) {
                orClauses.push(`(${columnName} IS NULL OR ${columnName}='')`);
            } else {
                orClauses.push(
                    `(LOWER(${columnName}) LIKE LOWER('%${delimiter}${ClauseCreator.escapeLike(clauseItem)}${delimiter}%') ESCAPE '\\')`,
                );
            }
        }

        orLikeClause += ClauseCreator.joinWithOr(orClauses);
        orLikeClause += ')';

        return orLikeClause;
    }
}
