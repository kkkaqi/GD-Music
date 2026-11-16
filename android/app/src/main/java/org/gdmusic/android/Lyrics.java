package org.gdmusic.android;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

final class Lyrics {
    private static final Pattern TIME = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern TAG = Pattern.compile("\\[[a-zA-Z]+:[^\\]]*\\]");
    record Line(long at, String text) {}

    static List<Line> parse(String original, String translation) {
        List<Line> plain = new ArrayList<>();
        Map<Long, String> timed = timedLines(original, plain);
        Map<Long, String> translated = timedLines(translation, new ArrayList<>());
        if (timed.isEmpty() && !plain.isEmpty()) return plain;
        List<Line> lines = new ArrayList<>();
        Map<Long, String> main = timed.isEmpty() ? translated : timed;
        main.forEach((at, text) -> {
            String extra = timed.isEmpty() ? null : translated.get(at);
            lines.add(new Line(at, extra == null || text.equals(extra) ? text : text + "\n" + extra));
        });
        return lines;
    }

    private static Map<Long, String> timedLines(String lyrics, List<Line> plain) {
        Map<Long, String> lines = new TreeMap<>();
        for (String row : lyrics.split("\\r?\\n")) {
            var times = TIME.matcher(row);
            String text = TAG.matcher(times.replaceAll("")).replaceAll("").trim();
            if (text.isEmpty()) continue;
            times.reset();
            boolean timed = false;
            while (times.find()) {
                timed = true;
                long time = 60_000L * Long.parseLong(times.group(1)) + 1000L * Long.parseLong(times.group(2));
                String fraction = times.group(3);
                if (fraction != null) time += Long.parseLong((fraction + "00").substring(0, 3));
                lines.putIfAbsent(time, text);
            }
            if (!timed) plain.add(new Line(-1, text));
        }
        return lines;
    }

    static int active(List<Line> lines, long position) {
        if (lines.isEmpty() || lines.get(0).at() < 0) return -1;
        int low = 0, high = lines.size();
        while (low < high) {
            int mid = (low + high) / 2;
            if (lines.get(mid).at() <= position) low = mid + 1;
            else high = mid;
        }
        return low - 1;
    }
}
