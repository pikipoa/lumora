import {
  ACCELERATION_DURATION_MS,
  computeAutoScrollStep,
  EDGE_THRESHOLD_PX,
  MAX_STEP_PX,
  MAX_STEP_PX_ACCELERATED,
  type EdgeScrollInput,
} from '@/lib/selectionAutoScroll';

/** コンテナは 100〜700（高さ600）に置く。閾値内かどうかだけを変える */
function input(overrides: Partial<EdgeScrollInput>): EdgeScrollInput {
  return {
    focusTop: 400,
    focusBottom: 420,
    containerTop: 100,
    containerBottom: 700,
    canScrollUp: true,
    canScrollDown: true,
    ...overrides,
  };
}

describe('computeAutoScrollStep', () => {
  it('中央付近ではスクロールしない', () => {
    expect(computeAutoScrollStep(input({}))).toBe(0);
  });

  it('上端の閾値内では負の値（上へスクロール）を返す', () => {
    const step = computeAutoScrollStep(input({ focusTop: 110, focusBottom: 130 }));
    expect(step).toBeLessThan(0);
    expect(step).toBeGreaterThanOrEqual(-MAX_STEP_PX);
  });

  it('下端の閾値内では正の値（下へスクロール）を返す', () => {
    const step = computeAutoScrollStep(input({ focusTop: 670, focusBottom: 690 }));
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(MAX_STEP_PX);
  });

  it('端に近いほど速くなる', () => {
    const near = computeAutoScrollStep(input({ focusTop: 690, focusBottom: 698 }));
    const far = computeAutoScrollStep(input({ focusTop: 660, focusBottom: 668 }));
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
  });

  it('コンテナの外側へ出ている場合は最大速度になる', () => {
    const step = computeAutoScrollStep(input({ focusTop: 800, focusBottom: 820 }));
    expect(step).toBe(MAX_STEP_PX);
  });

  // これ以上スクロールできないのに動かそうとすると、無限に呼ばれ続ける原因になる
  it('これ以上下へスクロールできない場合は0を返す', () => {
    expect(
      computeAutoScrollStep(input({ focusTop: 690, focusBottom: 698, canScrollDown: false })),
    ).toBe(0);
  });

  it('これ以上上へスクロールできない場合は0を返す', () => {
    expect(computeAutoScrollStep(input({ focusTop: 110, focusBottom: 130, canScrollUp: false }))).toBe(
      0,
    );
  });

  it('閾値のちょうど境界ではスクロールしない', () => {
    // 上端からちょうどEDGE_THRESHOLD_PX離れている＝「閾値内」ではない
    const step = computeAutoScrollStep(input({ focusTop: 100 + EDGE_THRESHOLD_PX, focusBottom: 400 }));
    expect(step).toBe(0);
  });

  it('上下どちらも閾値内なら上を優先する（極端に低いコンテナ）', () => {
    const step = computeAutoScrollStep(
      input({ containerTop: 300, containerBottom: 340, focusTop: 310, focusBottom: 330 }),
    );
    expect(step).toBeLessThan(0);
  });

  it('msAtEdgeを渡さない場合は従来どおりMAX_STEP_PXが上限になる（後方互換）', () => {
    const step = computeAutoScrollStep(input({ focusTop: 800, focusBottom: 820 }));
    expect(step).toBe(MAX_STEP_PX);
  });

  it('端に留まり始めた直後（msAtEdge=0）は穏やかな速度のまま', () => {
    const step = computeAutoScrollStep(input({ focusTop: 800, focusBottom: 820 }), 0);
    expect(step).toBe(MAX_STEP_PX);
  });

  it('端に留まり続けると、上限（ACCELERATION_DURATION_MS）で最大加速速度に達する', () => {
    const step = computeAutoScrollStep(
      input({ focusTop: 800, focusBottom: 820 }),
      ACCELERATION_DURATION_MS,
    );
    expect(step).toBe(MAX_STEP_PX_ACCELERATED);
  });

  it('加速の上限を超えて留まっても、それ以上は速くならない（青天井にしない）', () => {
    const step = computeAutoScrollStep(
      input({ focusTop: 800, focusBottom: 820 }),
      ACCELERATION_DURATION_MS * 10,
    );
    expect(step).toBe(MAX_STEP_PX_ACCELERATED);
  });

  it('留まる時間が長いほど速くなる（途中経過も単調増加）', () => {
    const early = computeAutoScrollStep(
      input({ focusTop: 800, focusBottom: 820 }),
      ACCELERATION_DURATION_MS * 0.25,
    );
    const late = computeAutoScrollStep(
      input({ focusTop: 800, focusBottom: 820 }),
      ACCELERATION_DURATION_MS * 0.75,
    );
    expect(late).toBeGreaterThan(early);
  });

  it('留まる時間が負でも穏やかな速度を下回らない（時計のずれ等の防御）', () => {
    const step = computeAutoScrollStep(input({ focusTop: 800, focusBottom: 820 }), -500);
    expect(step).toBe(MAX_STEP_PX);
  });
});
