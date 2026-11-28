import { MatDialogRef } from '@angular/material/dialog';
import { IMock, Mock, Times } from 'typemoq';
import { InputDialogComponent } from './input-dialog.component';

describe('InputDialogComponent', () => {
    let component: InputDialogComponent;
    const dataMock: any = { inputText: '' };
    let dialogRefMock: IMock<MatDialogRef<InputDialogComponent>>;

    beforeEach(() => {
        dialogRefMock = Mock.ofType<MatDialogRef<InputDialogComponent>>();

        component = new InputDialogComponent(dataMock, dialogRefMock.object);
    });

    describe('constructor', () => {
        it('should create', () => {
            // Arrange

            // Act

            // Assert
            expect(component).toBeDefined();
        });
    });

    describe('hasInputText', () => {
        it('should return false if inputText is empty', () => {
            // Arrange
            component.data.inputText = '';

            // Act

            // Assert
            expect(component.hasInputText).toBeFalsy();
        });

        it('should return false if inputText is space', () => {
            // Arrange
            component.data.inputText = ' ';

            // Act

            // Assert
            expect(component.hasInputText).toBeFalsy();
        });

        it('should return true if inputText is not empty or space', () => {
            // Arrange
            component.data.inputText = 'My input text';

            // Act

            // Assert
            expect(component.hasInputText).toBeTruthy();
        });
    });

    describe('closeDialog', () => {
        it('should not close the dialog if inputText is empty', () => {
            // Arrange
            component.data.inputText = '';

            // Act
            component.closeDialog();

            // Assert
            dialogRefMock.verify((x) => x.close(true), Times.never());
        });

        it('should not close the dialog if inputText is space', () => {
            // Arrange
            component.data.inputText = ' ';

            // Act
            component.closeDialog();

            // Assert
            dialogRefMock.verify((x) => x.close(true), Times.never());
        });

        it('should close the dialog if inputText is not empty or space', () => {
            // Arrange
            component.data.inputText = 'My input text';

            // Act
            component.closeDialog();

            // Assert
            dialogRefMock.verify((x) => x.close(true), Times.once());
        });
    });

    describe('allowEmpty (for example removing a nickname)', () => {
        it('should let OK close the dialog with an empty field', () => {
            component.data.inputText = '';
            component.data.allowEmpty = true;

            component.closeDialog();

            expect(component.canConfirm).toBe(true);
            dialogRefMock.verify((x) => x.close(true), Times.once());
            component.data.allowEmpty = false;
        });

        it('should still need text when an empty answer is not allowed', () => {
            component.data.inputText = '   ';
            component.data.allowEmpty = false;

            expect(component.canConfirm).toBe(false);
        });
    });
});
