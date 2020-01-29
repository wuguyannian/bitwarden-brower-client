import {
    Component,
    EventEmitter,
    Input,
    Output,
} from '@angular/core';

import { CipherType } from 'jslib/enums/cipherType';

import { CipherView } from 'jslib/models/view/cipherView';

@Component({
    selector: 'app-ciphers-list',
    templateUrl: 'ciphers-list.component.html',
})
export class CiphersListComponent {
    @Output() onSelected = new EventEmitter<CipherView>();
    @Output() onDoubleSelected = new EventEmitter<CipherView>();
    @Output() onView = new EventEmitter<CipherView>();
    @Input() ciphers: CipherView[];
    @Input() showView = false;
    @Input() title: string;

    cipherType = CipherType;

    selectCipher(c: CipherView) {
        this.onSelected.emit(c);
    }

    doubleSelectCipher(c: CipherView) {
        this.onDoubleSelected.emit(c);
    }

    viewCipher(c: CipherView) {
        this.onView.emit(c);
    }
}
