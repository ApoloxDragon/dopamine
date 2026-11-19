import { ClauseCreator } from './clause-creator';

describe('ClauseCreator', () => {
    describe('escapeQuotes', () => {
        it('should replace single quotes by double single quotes', () => {
            // Arrange
            const sourceString: string = `A string 'with' single 'quotes'`;

            // Act
            const returnString: string = ClauseCreator.escapeQuotes(sourceString);

            // Assert
            expect(returnString).toEqual(`A string ''with'' single ''quotes''`);
        });
    });

    describe('createTextInClause', () => {
        it('should create an in clause given a column name and text clause items', () => {
            // Arrange
            const columnName: string = 'TheColumn';
            const clauseItems: string[] = ['Item1', 'Item2', 'Item3'];

            // Act
            const inClause: string = ClauseCreator.createTextInClause(columnName, clauseItems);

            // Assert
            expect(inClause).toEqual(`TheColumn IN ('Item1','Item2','Item3')`);
        });
    });

    describe('createNumericInClause', () => {
        it('should create an in clause given a column name and numeric clause items', () => {
            // Arrange
            const columnName: string = 'TheColumn';
            const clauseItems: number[] = [1, 5, 8];

            // Act
            const inClause: string = ClauseCreator.createNumericInClause(columnName, clauseItems);

            // Assert
            expect(inClause).toEqual(`TheColumn IN (1,5,8)`);
        });
    });

    describe('createOrLikeClause', () => {
        it('should create an or like clause given a column name and clause items and a delimiter', () => {
            // Arrange
            const columnName: string = 'TheColumn';
            const clauseItems: string[] = ['Item1', '', 'Item3'];
            const delimiter: string = ';';

            // Act
            const orLikeClause: string = ClauseCreator.createOrLikeClause(columnName, clauseItems, delimiter);

            // Assert
            expect(orLikeClause).toEqual(
                ` ((LOWER(TheColumn) LIKE LOWER('%;Item1;%') ESCAPE '\\') OR (TheColumn IS NULL OR TheColumn='') OR (LOWER(TheColumn) LIKE LOWER('%;Item3;%') ESCAPE '\\'))`,
            );
        });
    });

    describe('torture', () => {
        it('should keep a NUL character exact, outside the quotes', () => {
            expect(ClauseCreator.escapeQuotes("a\u0000b'c")).toEqual("a' || char(0) || 'b''c");
        });

        it('should escape LIKE wildcards and the escape character itself', () => {
            expect(ClauseCreator.escapeLike("100%_\\'")).toEqual("100\\%\\_\\\\''");
        });

        it('should join many conditions as a shallow tree, and few as a flat list', () => {
            expect(ClauseCreator.joinBalanced(['a', 'b'], 'OR')).toEqual('a OR b');
            const joined: string = ClauseCreator.joinBalanced(
                Array.from({ length: 100000 }, (_, i: number) => `c${i}`),
                'AND',
            );
            let depth: number = 0;
            let deepest: number = 0;
            for (const character of joined) {
                depth += character === '(' ? 1 : character === ')' ? -1 : 0;
                deepest = Math.max(deepest, depth);
            }
            expect(deepest).toBeLessThanOrEqual(3);
            expect(joined.split(' AND ').length).toEqual(100000);
        });

        it.each([0, 1, -5, NaN])('should not loop forever with a group size of %p', (size: number) => {
            expect(ClauseCreator.joinBalanced(['a', 'b', 'c', 'd'], 'OR', size)).toContain('a');
        });
    });
});
