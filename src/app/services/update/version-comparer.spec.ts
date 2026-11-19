import { VersionComparer } from './version-comparer';

describe('VersionComparer', () => {
    describe('isNewerVersion', () => {
        it('should report newer version when old version is release and is older than new version which is release', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('2.0.3', '2.0.4');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should not report newer version when old version is release and is same as new version which is release', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('2.0.3', '2.0.3');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should  not report newer version when old version is release and is newer than new version which is release', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('2.0.4', '2.0.3');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should not report newer version if old version is the same as new version but new version has "preview" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0', '3.0.0-preview.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should not report newer version if old version is the same as new version but new version has "rc" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0', '3.0.0-rc.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should not report newer version if old version is newer than new version and old version has "preview" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.1-preview.1', '3.0.0');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should not report newer version if old version is newer than new version and old version has "rc" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.1-rc.1', '3.0.0');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report newer version if old version is older than new version and old version has "preview" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-preview.1', '3.0.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report newer version if old version is older than new version and old version has "rc" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.1', '3.0.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should not report newer version if old version is newer than new version and new version has "preview" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.1', '3.0.0-preview.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should not report newer version if old version is newer than new version and new version has "rc" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.1', '3.0.0-rc.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report newer version if old version is older than new version and new version has "preview" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0', '3.0.1-preview.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report newer version if old version is older than new version and new version has "rc" suffix', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0', '3.0.1-rc.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report newer version if both old and new version are "preview" versions with same version number but new version has higher iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-preview.1', '3.0.0-preview.2');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report newer version if both old and new version are "rc" versions with same version number but new version has higher iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.1', '3.0.0-rc.2');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report not newer version if both old and new version are "preview" versions with same version number but new version has lower iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-preview.2', '3.0.0-preview.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report not newer version if both old and new version are "rc" versions with same version number but new version has lower iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.2', '3.0.0-rc.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report newer version if old version is "preview" version and new version is "rc" version and both have the same version number and iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-preview.1', '3.0.0-rc.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });

        it('should report not newer version if old version is "rc" version and new version is "preview" version and both have the same version number and iteration', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.1', '3.0.0-preview.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report not newer version if old version is "rc" version and new version is "preview" version and iteration of new version is higher', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.1', '3.0.0-preview.2');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report not newer version if old version is "rc" version and new version is "preview" version and iteration of new version is lower', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-rc.5', '3.0.0-preview.1');

            // Assert
            expect(isNewerVersion).toBeFalsy();
        });

        it('should report newer version if old version is "preview" version and new version is "rc" version and iteration of new version is lower', () => {
            // Arrange

            // Act
            const isNewerVersion: boolean = VersionComparer.isNewerVersion('3.0.0-preview.6', '3.0.0-rc.1');

            // Assert
            expect(isNewerVersion).toBeTruthy();
        });
    });

    describe('custom build lines (for example 3.1.0-apolox.1)', () => {
        it('should see a higher iteration of the same version as newer', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.1', '3.1.0-apolox.2')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.2', '3.1.0-apolox.10')).toBeTruthy();
        });

        it('should not see the same or a lower iteration as newer', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.2', '3.1.0-apolox.2')).toBeFalsy();
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.2', '3.1.0-apolox.1')).toBeFalsy();
        });

        it('should see a higher version number as newer, whatever the iteration', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.3', '3.2.0-apolox.1')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.2.0-apolox.1', '3.1.0-apolox.9')).toBeFalsy();
        });

        it('should handle the suffix without an iteration (3.1.0-apolox)', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-apolox', '3.1.1-apolox')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-apolox', '3.1.0-apolox.1')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-apolox', '3.1.0-apolox')).toBeFalsy();
        });

        it('should compare against an official version by version number only', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.1', '3.1.1')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-apolox.1', '3.0.12')).toBeFalsy();
        });

        it('should keep the official preview and release candidate rules', () => {
            expect(VersionComparer.isNewerVersion('3.1.0-preview.1', '3.1.0-preview.2')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-preview.3', '3.1.0-rc.1')).toBeTruthy();
            expect(VersionComparer.isNewerVersion('3.1.0-rc.1', '3.1.0-preview.4')).toBeFalsy();
        });
    });
});
