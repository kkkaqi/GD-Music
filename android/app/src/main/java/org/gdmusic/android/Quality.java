package org.gdmusic.android;

enum Quality {
    STANDARD("128", "标准", "128K"),
    HIGHER("192", "较高", "192K"),
    PREMIUM("320", "高品", "320K"),
    LOSSLESS("740", "16bit 无损", "FLAC"),
    HI_RES("999", "24bit 无损", "FLAC");

    final String code;
    final String label;
    final String format;

    Quality(String code, String label, String format) {
        this.code = code;
        this.label = label;
        this.format = format;
    }

    static Quality fromCode(String code) {
        for (Quality quality : values()) if (quality.code.equals(code)) return quality;
        return STANDARD;
    }
}
