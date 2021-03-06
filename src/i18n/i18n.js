import i18next from 'i18next';
import * as en from './en.json'
import * as pl from './pl.json'
import * as it from './it.json'
import * as de from './de.json'
import * as fr from './fr.json'

export class i18n{

    static language;

    static init(lng){
        var self = this;
        i18n.language = lng;
        i18next.init({
            lng: lng,
            fallbackLng: 'en',
            resources: {
                en: {
                    translation: en
                },
                pl: {
                    translation: pl
                },
                it: {
                    translation: it
                },
                de: {
                    translation: de
                },
                fr: {
                    translation: fr
                }
            }
        }, (err, t) => {
        });
    }

    static t(key, opt){
        return i18next.t(key, opt)
    }
}
