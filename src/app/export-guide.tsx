/**
 * S3.5 エクスポート手順画面（2026-08-09）。原本は`export-guide.md`。
 *
 * 【なぜこの画面が要るか】
 * Lumoraは、最初のユーザー行動が「他社のサイトへ行き、開いたことのない設定画面を辿り、
 * 形式を正しく選び、最大7日待って戻ってくる」である。製品が何かを返す前に長い前提作業があり、
 * ここで詰まると二度と戻ってこない。S1で形式の一覧を読んだ人が
 * 「で、それはどこで手に入るのか」と止まる、その位置から来る。
 *
 * 【なぜ折りたたまないか】
 * 読む人は手順を上から順に追うのであって、探索はしない。折りたたむと
 * 「自分の端末の項目はどれか」を開いて確かめる手間が増える。カード・タブ・アイコン・目次は
 * 使わず、罫線と余白だけで区切る（DESIGN.md「Remove Before Add」）。
 * 装飾を足すのは警告ブロックだけ——Geminiの2つの落とし穴は、間違えると
 * 「エラー」ではなく「0件で成功したように見える」ため、本文と同じ見え方にはできない。
 */

import { Redirect } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';

const g = t.exportGuide;

export default function ExportGuideScreen() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">{g.title}</ThemedText>
        <ThemedText type="small">{g.intro}</ThemedText>

        {/* 早見表。「自分はどれを読めばいいか」を先に解決させる */}
        <ThemedView type="backgroundElement" style={styles.box}>
          <ThemedText type="smallBold">{g.chooserTitle}</ThemedText>
          {g.chooserRows.map((row) => (
            <ThemedView key={row.service} style={styles.chooserRow}>
              <ThemedText type="smallBold" style={styles.chooserService}>
                {row.service}
              </ThemedText>
              <ThemedText type="small" style={styles.chooserWhat}>
                {row.what}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {row.time}
              </ThemedText>
            </ThemedView>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            {g.chooserNote}
          </ThemedText>
        </ThemedView>

        {g.sections.map((section) => (
          <ThemedView key={section.name} style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionName}>
              {section.name}
            </ThemedText>

            {section.blocks.map((block, bi) => (
              <ThemedView key={`${section.name}-${bi}`} style={styles.block}>
                {block.heading ? <ThemedText type="smallBold">{block.heading}</ThemedText> : null}
                {block.body ? <ThemedText type="small">{block.body}</ThemedText> : null}
                {block.steps.map((step, si) => (
                  <ThemedView key={`${section.name}-${bi}-${si}`} style={styles.stepRow}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.stepNumber}>
                      {si + 1}.
                    </ThemedText>
                    <ThemedText type="small" style={styles.stepText}>
                      {step}
                    </ThemedText>
                  </ThemedView>
                ))}
              </ThemedView>
            ))}

            {/* Takeoutだけは外部サイトへ渡す。ここで止まらせないため、たどり着ける形にする */}
            {section.name.startsWith('Gemini') ? (
              <Pressable
                onPress={() => void Linking.openURL(g.takeoutUrl)}
                testID="export-guide-takeout-link"
              >
                <ThemedText type="link">{g.takeoutLinkLabel}</ThemedText>
              </Pressable>
            ) : null}

            {section.warnings.map((warning, wi) => (
              <ThemedView key={`${section.name}-w${wi}`} style={styles.warningBox}>
                <ThemedText type="small" style={styles.warningText}>
                  {warning}
                </ThemedText>
              </ThemedView>
            ))}
          </ThemedView>
        ))}

        <ThemedView type="backgroundElement" style={styles.box}>
          <ThemedText type="smallBold">{g.troubleTitle}</ThemedText>
          {g.troubles.map((trouble) => (
            <ThemedView key={trouble.q} style={styles.block}>
              <ThemedText type="smallBold">{trouble.q}</ThemedText>
              <ThemedText type="small">{trouble.a}</ThemedText>
            </ThemedView>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {g.footnote}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  content: { maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
  box: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  chooserRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  chooserService: { minWidth: 88 },
  chooserWhat: { flex: 1 },
  // 区切りは罫線と余白のみ。カード枠は使わない
  section: { gap: Spacing.two, paddingTop: Spacing.three },
  sectionName: { fontSize: 16 },
  block: { gap: Spacing.one },
  stepRow: { flexDirection: 'row', gap: Spacing.two },
  stepNumber: { minWidth: 20 },
  stepText: { flex: 1 },
  // 本文と同じ見え方にはできない唯一の要素（間違えると0件で成功したように見えるため）
  warningBox: {
    borderLeftWidth: 3,
    borderLeftColor: '#D93025',
    paddingLeft: Spacing.two,
    paddingVertical: Spacing.one,
  },
  warningText: { opacity: 0.9 },
  footnote: { opacity: 0.7 },
});
