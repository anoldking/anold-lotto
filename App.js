import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Modal,
  Alert,
  TextInput,
  Linking,
  ImageBackground,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

// -----------------------------------------------------------------
// 1. 로컬 내장 에셋(Offline First) 및 CDN 엔드포인트 설정
// -----------------------------------------------------------------
import LOCAL_HISTORY_DATA from './assets/history.min.json';
import LOCAL_LATEST_DATA from './assets/latest.json';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const POPUP_WIDTH = Math.min(SCREEN_WIDTH * 0.96, 420);
const BALL_GAP = 6;
const BALL_SIZE = Math.floor((POPUP_WIDTH - 28 - BALL_GAP * 6) / 7);

const GITHUB_USERNAME = 'anoldking';
const REPO_NAME = 'anold-lotto';

const PRIMARY_CDN_LATEST = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main/data/latest.json`;
const PRIMARY_CDN_HISTORY = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main/data/history.min.json`;
const SECONDARY_OFFICIAL_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber';

const calculateCurrentLatestRound = () => {
  const firstDrawDate = new Date('2002-12-07T21:15:00+09:00');
  const now = new Date();
  const diffMs = now.getTime() - firstDrawDate.getTime();
  if (diffMs < 0) return 1;
  return 1 + Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
};

const INITIAL_LATEST_ROUND = Math.max(
  LOCAL_LATEST_DATA?.drwNo || 1248,
  calculateCurrentLatestRound()
);

const STORAGE_KEY = '@my_saved_lotto_sets';
const CACHE_STORAGE_KEY = '@lotto_cache_v4_official';

const calculateDrwDate = (drwNo) => {
  const baseDate = new Date('2002-12-07T00:00:00');
  const targetDate = new Date(baseDate.getTime() + (drwNo - 1) * 7 * 24 * 60 * 60 * 1000);
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getBallColor = (number) => {
  if (number <= 10) return '#f59e0b';
  if (number <= 20) return '#0284c7';
  if (number <= 30) return '#dc2626';
  if (number <= 40) return '#64748b';
  return '#22c55e';
};

const PRIME_SET_WITH_ONE = new Set([1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]);
const TWIN_NUMBERS = new Set([11, 22, 33, 44]);

const generateBasicLottoSet = (excludedNumbers = []) => {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter(
    (n) => !excludedNumbers.includes(n)
  );
  if (pool.length < 6) return [];

  const selected = new Set();
  while (selected.size < 6 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.add(pool[idx]);
    pool.splice(idx, 1);
  }
  return Array.from(selected).sort((a, b) => a - b);
};

const calculateACValue = (sorted) => {
  const diffs = new Set();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      diffs.add(sorted[j] - sorted[i]);
    }
  }
  return diffs.size - (sorted.length - 1);
};

const getPaperDeadPattern = (numbers) => {
  const rowCounts = [0, 0, 0, 0, 0, 0, 0];
  const colCounts = [0, 0, 0, 0, 0, 0, 0];

  numbers.forEach((n) => {
    const rIdx = Math.floor((n - 1) / 7);
    const cIdx = (n - 1) % 7;
    if (rIdx < 7) rowCounts[rIdx]++;
    if (cIdx < 7) colCounts[cIdx]++;
  });

  const deadRows = rowCounts.filter((cnt) => cnt === 0).length;
  const deadCols = colCounts.filter((cnt) => cnt === 0).length;

  return { deadRows, deadCols, rowCounts, colCounts };
};

// 필수 조건 세이프가드
const isEssentialValid = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const minNum = sorted[0];
  const maxNum = sorted[5];

  if (minNum > 15 || maxNum < 30) return false;
  const range = maxNum - minNum;
  if (range < 25 || range > 44) return false;

  const sum = sorted.reduce((acc, cur) => acc + cur, 0);
  if (sum < 100 || sum > 180) return false;

  const oddCount = sorted.filter((n) => n % 2 !== 0).length;
  if (oddCount < 2 || oddCount > 4) return false;

  const lowCount = sorted.filter((n) => n <= 22).length;
  if (lowCount < 2 || lowCount > 4) return false;

  const ac = calculateACValue(sorted);
  if (ac < 7 || ac > 10) return false;

  return true;
};

// 12대 기본 통계 검증 함수
const isStrictStatisticallyValid = (numbers, dynamicContext) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const minNum = sorted[0];
  const maxNum = sorted[5];

  if (minNum > 15 || maxNum < 30) return false;
  const range = maxNum - minNum;
  if (range < 25 || range > 44) return false;

  let maxAdjacentDiff = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = sorted[i + 1] - sorted[i];
    if (diff > maxAdjacentDiff) maxAdjacentDiff = diff;
  }
  if (maxAdjacentDiff < 6 || maxAdjacentDiff > 25) return false;

  const sum = sorted.reduce((acc, cur) => acc + cur, 0);
  if (sum < 100 || sum > 180) return false;

  const oddCount = sorted.filter((n) => n % 2 !== 0).length;
  if (oddCount < 2 || oddCount > 4) return false;

  const lowCount = sorted.filter((n) => n <= 22).length;
  if (lowCount < 2 || lowCount > 4) return false;

  const ac = calculateACValue(sorted);
  if (ac < 7 || ac > 10) return false;

  const primeCount = sorted.filter((n) => PRIME_SET_WITH_ONE.has(n)).length;
  if (primeCount < 1 || primeCount > 3) return false;

  const mult3Count = sorted.filter((n) => n % 3 === 0).length;
  if (mult3Count < 1 || mult3Count > 3) return false;

  const mult5Count = sorted.filter((n) => n % 5 === 0).length;
  if (mult5Count >= 3) return false;

  const twinCount = sorted.filter((n) => TWIN_NUMBERS.has(n)).length;
  if (twinCount >= 2) return false;

  const lastDigitCounts = {};
  for (const n of sorted) {
    const d = n % 10;
    lastDigitCounts[d] = (lastDigitCounts[d] || 0) + 1;
    if (lastDigitCounts[d] >= 3) return false;
  }

  let consecutivePairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) {
      if (i < sorted.length - 2 && sorted[i + 2] - sorted[i + 1] === 1) {
        return false;
      }
      consecutivePairs++;
      i++;
    }
  }
  if (consecutivePairs > 1) return false;

  const sectionCounts = [0, 0, 0, 0, 0];
  sorted.forEach((n) => {
    if (n <= 9) sectionCounts[0]++;
    else if (n <= 19) sectionCounts[1]++;
    else if (n <= 29) sectionCounts[2]++;
    else if (n <= 39) sectionCounts[3]++;
    else sectionCounts[4]++;
  });
  const deadSections = sectionCounts.filter((cnt) => cnt === 0).length;
  if (deadSections < 1 || deadSections > 2) return false;

  const { deadRows, deadCols } = getPaperDeadPattern(sorted);
  if (deadRows < 2 || deadRows > 4) return false;
  if (deadCols < 2 || deadCols > 4) return false;

  if (dynamicContext) {
    const { round1Numbers, doubleCarryOver } = dynamicContext;

    if (round1Numbers && round1Numbers.length > 0) {
      const carryCount = sorted.filter((n) => round1Numbers.includes(n)).length;
      if (carryCount >= 2) return false;
    }

    if (doubleCarryOver && doubleCarryOver.length > 0) {
      if (sorted.some((n) => doubleCarryOver.includes(n))) return false;
    }
  }

  return true;
};

// QR 파서
const parseLottoQrUrl = (url) => {
  try {
    const vIndex = url.indexOf('?v=') !== -1 ? url.indexOf('?v=') + 3 : (url.indexOf('&v=') !== -1 ? url.indexOf('&v=') + 3 : -1);
    if (vIndex === -1) return null;

    const vParam = url.substring(vIndex).split('&')[0];
    const roundMatch = vParam.match(/^(\d{1,5})/);
    if (!roundMatch) return null;

    const round = parseInt(roundMatch[1], 10);
    const body = vParam.substring(roundMatch[1].length);

    const rawGames = body.split(/[a-zA-Z]+/).filter((str) => str.length >= 12);

    const parsedGames = rawGames.map((gameStr) => {
      const numbers = [];
      const chunk = gameStr.slice(0, 12);
      for (let i = 0; i < 12; i += 2) {
        const num = parseInt(chunk.substring(i, i + 2), 10);
        if (num >= 1 && num <= 45) {
          numbers.push(num);
        }
      }
      return numbers.sort((a, b) => a - b);
    }).filter((g) => g.length === 6);

    if (parsedGames.length === 0) return null;

    return { round, games: parsedGames };
  } catch (err) {
    console.error('QR 파싱 실패:', err);
    return null;
  }
};

export default function App() {
  const gameLabels = ['A', 'B', 'C', 'D', 'E'];
  const allNumbers = Array.from({ length: 45 }, (_, i) => i + 1);

  const [latestRound, setLatestRound] = useState(INITIAL_LATEST_ROUND);
  const [lottoCache, setLottoCache] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingWinningRounds, setIsLoadingWinningRounds] = useState(false);

  const [games, setGames] = useState([]);
  const [generationTitle, setGenerationTitle] = useState('🎉 번호 추첨 완료');
  const [activeGenOption, setActiveGenOption] = useState('OPT_STRICT');

  const [excludedNumbers, setExcludedNumbers] = useState([]);

  const [showPatternThisWeek, setShowPatternThisWeek] = useState(false);
  const [showPattern1WeekAgo, setShowPattern1WeekAgo] = useState(false);
  const [showPattern2WeeksAgo, setShowPattern2WeeksAgo] = useState(false);

  const [manualSelectedNumbers, setManualSelectedNumbers] = useState([]);
  const [isManualModalVisible, setIsManualModalVisible] = useState(false);

  const [isGeneratedModalVisible, setIsGeneratedModalVisible] = useState(false);
  const [isExcludeModalVisible, setIsExcludeModalVisible] = useState(false);
  const [isWinningModalVisible, setIsWinningModalVisible] = useState(false);
  const [isCameraModalVisible, setIsCameraModalVisible] = useState(false);
  const [isSavedModalVisible, setIsSavedModalVisible] = useState(false);

  const [isAnalysisModalVisible, setIsAnalysisModalVisible] = useState(false);
  const [analysisTargetData, setAnalysisTargetData] = useState(null);

  const [isQrResultModalVisible, setIsQrResultModalVisible] = useState(false);
  const [qrResultData, setQrResultData] = useState(null);

  const [savedSets, setSavedSets] = useState([]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const [winningTopRound, setWinningTopRound] = useState(INITIAL_LATEST_ROUND);
  const [searchRoundInput, setSearchRoundInput] = useState('');

  const totalSavedGamesCount = savedSets.reduce((sum, item) => sum + (item.games?.length || 0), 0);

  const displayed15Rounds = Array.from({ length: 15 }, (_, i) => winningTopRound - i).filter((r) => r >= 1);
  const bottomRound = displayed15Rounds.length > 0 ? displayed15Rounds[displayed15Rounds.length - 1] : winningTopRound;

  // 앱 실행 시 세로 모드(Portrait) 영구 고정
  useEffect(() => {
    async function lockScreen() {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLockPlatform.PORTRAIT_UP);
      } catch (e) {
        console.log('방향 고정 오류:', e);
      }
    }
    lockScreen();
  }, []);

  const fetchLottoRoundWithFallback = async (drwNo) => {
    const cacheBuster = `?t=${Date.now()}`;

    if (drwNo === calculateCurrentLatestRound()) {
      try {
        const resPrimary = await fetch(`${PRIMARY_CDN_LATEST}${cacheBuster}`);
        if (resPrimary.ok) {
          const data = await resPrimary.json();
          if (data && data.returnValue === 'success' && data.drwNo === drwNo) {
            return {
              drwNo: data.drwNo,
              drwNoDate: data.drwNoDate,
              numbers: [
                data.drwtNo1,
                data.drwtNo2,
                data.drwtNo3,
                data.drwtNo4,
                data.drwtNo5,
                data.drwtNo6,
              ].sort((a, b) => a - b),
              bnusNo: data.bnusNo,
            };
          }
        }
      } catch (e) {
        console.warn(`[1차 CDN latest 실패] 회차 ${drwNo}, 2차 서버 폴백`);
      }
    }

    try {
      const url = `${SECONDARY_OFFICIAL_API}&drwNo=${drwNo}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });
      if (!response.ok) return null;
      const data = await response.json();

      if (data && data.returnValue === 'success') {
        return {
          drwNo: data.drwNo,
          drwNoDate: data.drwNoDate,
          numbers: [
            data.drwtNo1,
            data.drwtNo2,
            data.drwtNo3,
            data.drwtNo4,
            data.drwtNo5,
            data.drwtNo6,
          ].sort((a, b) => a - b),
          bnusNo: data.bnusNo,
        };
      }
      return null;
    } catch (e) {
      console.log(`[2차 서버 실패] ${drwNo}회차 수신 오류:`, e.message);
      return null;
    }
  };

  const getLottoNumbersByRound = useCallback(
    (drwNo) => {
      const cached = lottoCache[drwNo];
      if (cached && cached.numbers && cached.numbers.length === 6 && !cached.isPending) {
        return cached;
      }
      return {
        drwNo,
        drwNoDate: calculateDrwDate(drwNo),
        numbers: [1, 2, 3, 4, 5, 6],
        bnusNo: 7,
        isPending: true,
      };
    },
    [lottoCache]
  );

  const prefetchRounds = useCallback(
    async (roundList, currentCache = lottoCache) => {
      const missingRounds = roundList.filter(
        (r) => !currentCache[r] || currentCache[r].isPending
      );
      if (missingRounds.length === 0) return currentCache;

      setIsLoadingWinningRounds(true);
      const updated = { ...currentCache };
      let hasChanges = false;

      try {
        const resHistory = await fetch(`${PRIMARY_CDN_HISTORY}?t=${Date.now()}`);
        if (resHistory.ok) {
          const tuples = await resHistory.json();
          tuples.forEach(([drwNo, date, numbers, bonus]) => {
            if (!updated[drwNo] || updated[drwNo].isPending) {
              updated[drwNo] = {
                drwNo,
                drwNoDate: date,
                numbers: numbers.sort((a, b) => a - b),
                bnusNo: bonus,
                isPending: false,
              };
              hasChanges = true;
            }
          });
        }
      } catch (err) {
        console.warn('[1차 히스토리 CDN 로드 실패] 2차 개별 호출로 폴백');
      }

      const stillMissing = roundList.filter((r) => !updated[r] || updated[r].isPending);
      for (const r of stillMissing) {
        const fetched = await fetchLottoRoundWithFallback(r);
        if (fetched) {
          updated[r] = { ...fetched, isPending: false };
          hasChanges = true;
        }
        await new Promise((res) => setTimeout(res, 60));
      }

      if (hasChanges) {
        setLottoCache(updated);
        await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(updated));
      }
      setIsLoadingWinningRounds(false);
      return updated;
    },
    [lottoCache]
  );

  useEffect(() => {
    if (isWinningModalVisible) {
      prefetchRounds(displayed15Rounds);
    }
  }, [isWinningModalVisible, winningTopRound, prefetchRounds]);

  const getDynamicContextData = useCallback(() => {
    const round1 = getLottoNumbersByRound(latestRound);
    const round2 = latestRound > 1 ? getLottoNumbersByRound(latestRound - 1) : null;

    const list1 = round1 && !round1.isPending ? round1.numbers : [];
    const list2 = round2 && !round2.isPending ? round2.numbers : [];

    const doubleCarryOver = list1.filter((n) => list2.includes(n));

    return {
      round1Numbers: list1,
      doubleCarryOver,
    };
  }, [latestRound, getLottoNumbersByRound]);

  // 번호 생성 엔진
  const generateStrictFilteredSet = useCallback(
    (excluded = []) => {
      const dynamicContext = getDynamicContextData();

      let attempts = 0;
      while (attempts < 20000) {
        attempts++;
        const candidate = generateBasicLottoSet(excluded);
        if (candidate.length < 6) return [];

        if (isStrictStatisticallyValid(candidate, dynamicContext)) {
          return candidate;
        }
      }

      attempts = 0;
      while (attempts < 5000) {
        attempts++;
        const candidate = generateBasicLottoSet(excluded);
        if (candidate.length < 6) return [];

        if (isEssentialValid(candidate, { useSum: true, useOddEven: true, useHighLow: true, useAC: true })) {
          return candidate;
        }
      }

      while (true) {
        const candidate = generateBasicLottoSet(excluded);
        const sum = candidate.reduce((acc, cur) => acc + cur, 0);
        if (sum >= 100 && sum <= 180) {
          return candidate;
        }
      }
    },
    [getDynamicContextData]
  );

  // 10대 알고리즘 연산
  const get10ExclusionAnalytics = useCallback(() => {
    const round0 = getLottoNumbersByRound(latestRound)?.numbers || [];
    const round1 = latestRound > 1 ? getLottoNumbersByRound(latestRound - 1)?.numbers || [] : [];

    const counts5 = {}, counts10 = {}, counts30 = {}, absenceWeeks = {};
    for (let i = 1; i <= 45; i++) {
      counts5[i] = 0;
      counts10[i] = 0;
      counts30[i] = 0;
      absenceWeeks[i] = 0;
    }

    for (let r = latestRound; r >= Math.max(1, latestRound - 30); r--) {
      const rData = getLottoNumbersByRound(r);
      if (rData && rData.numbers && !rData.isPending) {
        const diff = latestRound - r;
        rData.numbers.forEach((n) => {
          if (diff < 5) counts5[n]++;
          if (diff < 10) counts10[n]++;
          if (diff < 30) counts30[n]++;
        });
      }
    }

    for (let i = 1; i <= 45; i++) {
      let gap = 0;
      for (let r = latestRound; r >= 1; r--) {
        const rData = getLottoNumbersByRound(r);
        if (rData && rData.numbers && !rData.isPending && rData.numbers.includes(i)) break;
        gap++;
      }
      absenceWeeks[i] = gap;
    }

    const algo1_LongCold = allNumbers.filter((n) => absenceWeeks[n] >= 30);
    const algo2_ShortCold = allNumbers.filter((n) => counts10[n] === 0);
    const algo3_LowFreq = allNumbers.filter((n) => counts30[n] <= 1);
    const algo4_Overheated = allNumbers.filter((n) => counts5[n] >= 3 || counts10[n] >= 4);
    const algo5_CycleOutlier = allNumbers.filter((n) => absenceWeeks[n] <= 1 && round0.includes(n));
    const algo6_Trend = round0.filter((n) => round1.includes(n));

    const digitCounts = {};
    round0.forEach((n) => {
      const d = n % 10;
      digitCounts[d] = (digitCounts[d] || 0) + 1;
    });
    const algo7_SameEnd = allNumbers.filter((n) => {
      const d = n % 10;
      return digitCounts[d] >= 2 && !round0.includes(n);
    });

    const secCounts = [0, 0, 0, 0, 0];
    round0.forEach((n) => {
      const idx = Math.min(4, Math.floor((n - 1) / 10));
      secCounts[idx]++;
    });
    const algo8_Section = allNumbers.filter((n) => {
      const idx = Math.min(4, Math.floor((n - 1) / 10));
      return secCounts[idx] >= 3;
    });

    const algo9_LastDraw = [...round0];

    const scores = {};
    for (let i = 1; i <= 45; i++) scores[i] = 0;

    algo1_LongCold.forEach((n) => (scores[n] += 3));
    algo2_ShortCold.forEach((n) => (scores[n] += 2));
    algo3_LowFreq.forEach((n) => (scores[n] += 2));
    algo4_Overheated.forEach((n) => (scores[n] += 4));
    algo6_Trend.forEach((n) => (scores[n] += 5));
    algo7_SameEnd.forEach((n) => (scores[n] += 3));
    algo8_Section.forEach((n) => (scores[n] += 2));

    const algo10_TopScores = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([num]) => Number(num))
      .sort((a, b) => a - b);

    return {
      algo1_LongCold,
      algo2_ShortCold,
      algo3_LowFreq,
      algo4_Overheated,
      algo5_CycleOutlier,
      algo6_Trend,
      algo7_SameEnd,
      algo8_Section,
      algo9_LastDraw,
      algo10_TopScores,
    };
  }, [latestRound, getLottoNumbersByRound, allNumbers]);

  const handleApplySingleAlgorithm = (numbersList, label) => {
    if (!numbersList || numbersList.length === 0) {
      Alert.alert('알림', `${label} 조건에 해당하는 번호가 없습니다.`);
      return;
    }

    const merged = Array.from(new Set([...excludedNumbers, ...numbersList])).sort((a, b) => a - b);
    if (merged.length > 39) {
      Alert.alert('알림', `제외수가 ${merged.length}개로 한도(39개)를 초과하여 추가할 수 없습니다.`);
      return;
    }

    setExcludedNumbers(merged);
    Alert.alert(
      '제외수 등록 완료',
      `${label} (${numbersList.length}개): [${numbersList.join(', ')}]\n\n제외수에 정상 반영되었습니다.`
    );
  };

  const applySmart10AlgorithmSet = () => {
    const { algo10_TopScores } = get10ExclusionAnalytics();
    if (algo10_TopScores.length === 0) {
      Alert.alert('알림', '추천 제외수를 산출할 데이터가 부족합니다.');
      return;
    }
    setExcludedNumbers(algo10_TopScores);
    Alert.alert(
      '10대 알고리즘 추천 완료',
      `종합 가중치 평가를 거친 12개 정밀 제외수가 설정되었습니다.\n\n제외 번호: [${algo10_TopScores.join(', ')}]`
    );
  };

  const calculateNumbersAnalysis = useCallback(
    (targetNumbers, baseRound, titleText, subText, bonusNum = null, sourceType = null, sourceIndex = null) => {
      if (!targetNumbers || targetNumbers.length < 6) return null;

      const nums = [...targetNumbers].sort((a, b) => a - b);
      const numSet = new Set(nums);

      let rank3Count = 0;
      let rank4Count = 0;
      let rank5Count = 0;

      for (let r = 1; r <= latestRound; r++) {
        const rData = getLottoNumbersByRound(r);
        if (!rData || !rData.numbers || rData.isPending) continue;
        const matches = rData.numbers.filter((n) => numSet.has(n)).length;
        if (matches === 5) rank3Count++;
        else if (matches === 4) rank4Count++;
        else if (matches === 3) rank5Count++;
      }

      const oddCount = nums.filter((n) => n % 2 !== 0).length;
      const evenCount = 6 - oddCount;
      const sum = nums.reduce((acc, cur) => acc + cur, 0);
      const lowCount = nums.filter((n) => n <= 22).length;
      const highCount = 6 - lowCount;

      let carryOverNumbers = [];
      if (sourceType === 'WINNING') {
        if (baseRound > 1) {
          const prevRoundData = getLottoNumbersByRound(baseRound - 1);
          if (prevRoundData && prevRoundData.numbers && !prevRoundData.isPending) {
            carryOverNumbers = nums.filter((n) => prevRoundData.numbers.includes(n));
          }
        }
      } else {
        const latestOfficialData = getLottoNumbersByRound(latestRound);
        if (latestOfficialData && latestOfficialData.numbers && !latestOfficialData.isPending) {
          carryOverNumbers = nums.filter((n) => latestOfficialData.numbers.includes(n));
        }
      }

      const targetBaseRound = sourceType === 'WINNING' ? baseRound : latestRound;
      const recent30Counts = {};
      nums.forEach((n) => (recent30Counts[n] = 0));
      const startR = Math.max(1, targetBaseRound - 30);
      for (let r = targetBaseRound; r >= startR; r--) {
        const rData = getLottoNumbersByRound(r);
        if (rData && rData.numbers && !rData.isPending) {
          rData.numbers.forEach((n) => {
            if (numSet.has(n)) {
              recent30Counts[n] = (recent30Counts[n] || 0) + 1;
            }
          });
        }
      }

      const absenceWeeks = {};
      nums.forEach((n) => {
        let count = 0;
        const searchStartRound = sourceType === 'WINNING' ? baseRound - 1 : latestRound;
        for (let r = searchStartRound; r >= 1; r--) {
          const rData = getLottoNumbersByRound(r);
          if (rData && rData.numbers && !rData.isPending && rData.numbers.includes(n)) {
            break;
          }
          count++;
        }
        absenceWeeks[n] = count;
      });

      const pairCounts = {};
      for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
          const n1 = nums[i];
          const n2 = nums[j];
          const key = `${n1}-${n2}`;
          pairCounts[key] = { n1, n2, count: 0 };
        }
      }

      for (let r = 1; r <= latestRound; r++) {
        const rData = getLottoNumbersByRound(r);
        if (rData && rData.numbers && !rData.isPending) {
          const rSet = new Set(rData.numbers);
          Object.keys(pairCounts).forEach((key) => {
            const pair = pairCounts[key];
            if (rSet.has(pair.n1) && rSet.has(pair.n2)) {
              pair.count++;
            }
          });
        }
      }

      const topPairs = Object.values(pairCounts).sort((a, b) => b.count - a.count).slice(0, 3);
      const { deadRows, deadCols, rowCounts, colCounts } = getPaperDeadPattern(nums);

      const numbersThisWeek = getLottoNumbersByRound(targetBaseRound)?.numbers || [];
      const numbers1WeekAgo = targetBaseRound > 1 ? getLottoNumbersByRound(targetBaseRound - 1)?.numbers || [] : [];
      const numbers2WeeksAgo = targetBaseRound > 2 ? getLottoNumbersByRound(targetBaseRound - 2)?.numbers || [] : [];

      const primeNumbers = nums.filter((n) => PRIME_SET_WITH_ONE.has(n));
      const compositeNumbers = nums.filter((n) => !PRIME_SET_WITH_ONE.has(n));
      const mult3Numbers = nums.filter((n) => n % 3 === 0);
      const mult5Numbers = nums.filter((n) => n % 5 === 0);
      const twinNumbers = nums.filter((n) => TWIN_NUMBERS.has(n));

      const endDigitMap = {};
      nums.forEach((n) => {
        const d = n % 10;
        if (!endDigitMap[d]) endDigitMap[d] = [];
        endDigitMap[d].push(n);
      });
      const sameEndPairs = Object.entries(endDigitMap).filter(([_, list]) => list.length >= 2);

      const consecutivePairsList = [];
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] - nums[i] === 1) {
          consecutivePairsList.push(`${nums[i]}-${nums[i + 1]}`);
        }
      }

      const minAbsenceVal = Math.min(...nums.map((n) => absenceWeeks[n]));
      const hotNumbersInSet = nums.filter((n) => absenceWeeks[n] === minAbsenceVal);

      const maxAbsenceVal = Math.max(...nums.map((n) => absenceWeeks[n]));
      const coldNumbersInSet = nums.filter((n) => absenceWeeks[n] === maxAbsenceVal);

      return {
        numbers: nums,
        bonusNum,
        titleText,
        subText,
        sourceType,
        sourceIndex,
        baseRound: targetBaseRound,
        numbersThisWeek,
        numbers1WeekAgo,
        numbers2WeeksAgo,
        rank3Count,
        rank4Count,
        rank5Count,
        oddCount,
        evenCount,
        sum,
        lowCount,
        highCount,
        carryOverNumbers,
        recent30Counts,
        absenceWeeks,
        topPairs,
        rowCounts,
        colCounts,
        deadRowCount: deadRows,
        deadColCount: deadCols,
        primeNumbers,
        compositeNumbers,
        mult3Numbers,
        mult5Numbers,
        twinNumbers,
        sameEndPairs,
        consecutivePairsList,
        minAbsenceVal,
        hotNumbersInSet,
        maxAbsenceVal,
        coldNumbersInSet,
      };
    },
    [latestRound, getLottoNumbersByRound]
  );

  const getFlatSavedGames = useCallback(() => {
    const flat = [];
    savedSets.forEach((item) => {
      item.games.forEach((g, gIdx) => {
        const label = item.games.length === 1 ? '수동' : gameLabels[gIdx];
        flat.push({
          id: item.id,
          date: item.date,
          game: g,
          gIdx,
          gameLabel: label,
        });
      });
    });
    return flat;
  }, [savedSets, gameLabels]);

  const handleDeleteGameFromAnalysis = (targetIndex) => {
    const flatList = getFlatSavedGames();
    if (targetIndex < 0 || targetIndex >= flatList.length) return;
    const target = flatList[targetIndex];

    Alert.alert('저장 번호 삭제', `${target.gameLabel} 게임을 보관함에서 삭제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            const updated = savedSets
              .map((item) => {
                if (item.id === target.id) {
                  const remainingGames = item.games.filter((_, idx) => idx !== target.gIdx);
                  return { ...item, games: remainingGames };
                }
                return item;
              })
              .filter((item) => item.games.length > 0);

            setSavedSets(updated);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

            const newFlat = [];
            updated.forEach((item) => {
              item.games.forEach((g, gIdx) => {
                const label = item.games.length === 1 ? '수동' : gameLabels[gIdx];
                newFlat.push({
                  id: item.id,
                  date: item.date,
                  game: g,
                  gIdx,
                  gameLabel: label,
                });
              });
            });

            if (newFlat.length === 0) {
              setIsAnalysisModalVisible(false);
              Alert.alert('삭제 완료', '모든 저장 번호가 삭제되었습니다.');
            } else {
              const nextIdx = Math.min(targetIndex, newFlat.length - 1);
              const nextTarget = newFlat[nextIdx];
              const result = calculateNumbersAnalysis(
                nextTarget.game,
                latestRound,
                `저장 번호 정밀 분석 (${nextTarget.gameLabel})`,
                `저장일시: ${nextTarget.date} | 최신 제${latestRound}회 공식 기준 심층 분석`,
                null,
                'SAVED',
                nextIdx
              );
              setAnalysisTargetData(result);
            }
          } catch (e) {
            Alert.alert('삭제 오류', '게임을 삭제하는 중 문제가 발생했습니다.');
          }
        },
      },
    ]);
  };

  const navigateWinningAnalysis = async (targetRound) => {
    if (targetRound < 1 || targetRound > latestRound) return;
    let roundData = getLottoNumbersByRound(targetRound);

    if (roundData.isPending) {
      const fetched = await fetchLottoRoundWithFallback(targetRound);
      if (fetched) {
        roundData = { ...fetched, isPending: false };
        const updated = { ...lottoCache, [fetched.drwNo]: roundData };
        setLottoCache(updated);
        await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(updated));
      }
    }

    const result = calculateNumbersAnalysis(
      roundData.numbers,
      targetRound,
      `제 ${targetRound}회 당첨번호 정밀 분석`,
      `제${targetRound}회 당시 공식 기준 심층 데이터 분석`,
      roundData.bnusNo,
      'WINNING',
      targetRound
    );
    setAnalysisTargetData(result);
  };

  const navigateSavedAnalysis = (targetIndex) => {
    const flatList = getFlatSavedGames();
    if (targetIndex < 0 || targetIndex >= flatList.length) return;
    const target = flatList[targetIndex];

    const result = calculateNumbersAnalysis(
      target.game,
      latestRound,
      `저장 번호 정밀 분석 (${target.gameLabel})`,
      `저장일시: ${target.date} | 최신 제${latestRound}회 공식 기준 심층 분석`,
      null,
      'SAVED',
      targetIndex
    );
    setAnalysisTargetData(result);
  };

  const toggleExcludeNumber = (num) => {
    if (excludedNumbers.includes(num)) {
      setExcludedNumbers(excludedNumbers.filter((n) => n !== num));
    } else {
      if (excludedNumbers.length >= 39) {
        Alert.alert('알림', '최소 6개의 번호는 남아있어야 합니다 (최대 39개 제외).');
        return;
      }
      setExcludedNumbers([...excludedNumbers, num].sort((a, b) => a - b));
    }
  };

  const handleInvertExcludeNumbers = () => {
    const all = Array.from({ length: 45 }, (_, i) => i + 1);
    const inverted = all.filter((n) => !excludedNumbers.includes(n));
    if (inverted.length > 39) {
      Alert.alert('반전 불가', '최소 6개의 번호는 남아있어야 합니다.');
      return;
    }
    setExcludedNumbers(inverted);
  };

  const toggleManualNumber = (num) => {
    if (manualSelectedNumbers.includes(num)) {
      setManualSelectedNumbers(manualSelectedNumbers.filter((n) => n !== num));
    } else {
      if (manualSelectedNumbers.length >= 6) {
        Alert.alert('알림', '로또 번호는 6개까지만 선택할 수 있습니다.');
        return;
      }
      setManualSelectedNumbers([...manualSelectedNumbers, num].sort((a, b) => a - b));
    }
  };

  const handleSaveManualNumbers = async () => {
    if (manualSelectedNumbers.length !== 6) {
      Alert.alert('알림', '번호를 6개 모두 선택해 주세요.');
      return;
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
      now.getDate()
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newEntry = {
      id: Date.now().toString(),
      date: `${dateStr} (수동)`,
      games: [manualSelectedNumbers],
    };
    try {
      const updated = [newEntry, ...savedSets];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedSets(updated);
      setIsManualModalVisible(false);
      Alert.alert('등록 완료', '선택한 6개 번호가 저장함에 보관되었습니다.', [
        { text: '확인', onPress: () => setIsSavedModalVisible(true) },
      ]);
    } catch (e) {
      Alert.alert('저장 실패', '수동 번호를 저장하는 중 오류가 발생했습니다.');
    }
  };

  const handleRefreshLatestRound = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      let calc = calculateCurrentLatestRound();
      let fetched = await fetchLottoRoundWithFallback(calc);

      if (!fetched && calc > 1) {
        calc = calc - 1;
        fetched = await fetchLottoRoundWithFallback(calc);
      }

      if (fetched) {
        setLatestRound(fetched.drwNo);
        const updated = { ...lottoCache, [fetched.drwNo]: { ...fetched, isPending: false } };
        setLottoCache(updated);
        await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(updated));
        Alert.alert('동기화 완료', `제 ${fetched.drwNo}회 당첨번호가 반영되었습니다.`);
      } else {
        Alert.alert('안내', '최신 당첨번호를 확인했습니다.');
      }
    } catch (e) {
      Alert.alert('네트워크 안내', '인터넷 연결 상태를 확인해 주세요.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const initApp = async () => {
      let localCache = {};

      try {
        const stored = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
        if (stored) {
          localCache = JSON.parse(stored);
        }
      } catch (e) {
        console.log('캐시 로드 실패:', e);
      }

      if (Array.isArray(LOCAL_HISTORY_DATA) && LOCAL_HISTORY_DATA.length > 0) {
        LOCAL_HISTORY_DATA.forEach(([drwNo, date, numbers, bonus]) => {
          if (!localCache[drwNo]) {
            localCache[drwNo] = {
              drwNo,
              drwNoDate: date,
              numbers: numbers.sort((a, b) => a - b),
              bnusNo: bonus,
              isPending: false,
            };
          }
        });
      }

      if (LOCAL_LATEST_DATA && LOCAL_LATEST_DATA.returnValue === 'success') {
        const lNum = LOCAL_LATEST_DATA.drwNo;
        if (!localCache[lNum]) {
          localCache[lNum] = {
            drwNo: lNum,
            drwNoDate: LOCAL_LATEST_DATA.drwNoDate,
            numbers: [
              LOCAL_LATEST_DATA.drwtNo1,
              LOCAL_LATEST_DATA.drwtNo2,
              LOCAL_LATEST_DATA.drwtNo3,
              LOCAL_LATEST_DATA.drwtNo4,
              LOCAL_LATEST_DATA.drwtNo5,
              LOCAL_LATEST_DATA.drwtNo6,
            ].sort((a, b) => a - b),
            bnusNo: LOCAL_LATEST_DATA.bnusNo,
            firstWinamnt: LOCAL_LATEST_DATA.firstWinamnt,
            isPending: false,
          };
        }
      }

      const currentStoredMax = Math.max(...Object.keys(localCache).map(Number), 1248);
      setLatestRound(currentStoredMax);
      setWinningTopRound(currentStoredMax);
      setLottoCache(localCache);

      let calc = calculateCurrentLatestRound();
      if (calc > currentStoredMax) {
        let latestFetched = await fetchLottoRoundWithFallback(calc);
        if (!latestFetched && calc > 1) {
          calc = calc - 1;
          latestFetched = await fetchLottoRoundWithFallback(calc);
        }

        if (latestFetched && latestFetched.drwNo > currentStoredMax) {
          localCache[latestFetched.drwNo] = { ...latestFetched, isPending: false };
          setLatestRound(latestFetched.drwNo);
          setWinningTopRound(latestFetched.drwNo);
          setLottoCache(localCache);
          await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(localCache));
        }
      }
    };

    initApp();
    loadSavedSets();
  }, []);

  const loadSavedSets = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) setSavedSets(JSON.parse(data));
    } catch (e) {
      console.log('로드 에러:', e);
    }
  };

  const checkSingleRoundResult = (gameNumbers, winningNumbers, bonusNumber) => {
    if (!winningNumbers || winningNumbers.length < 6) {
      return { rank: '조회 대기', grade: 0, color: '#64748b', bg: '#f1f5f9' };
    }
    const matchCount = gameNumbers.filter((n) => winningNumbers.includes(n)).length;
    const matchBonus = gameNumbers.includes(bonusNumber);

    if (matchCount === 6) return { rank: '🥇 1등 당첨!', grade: 1, color: '#dc2626', bg: '#fee2e2' };
    if (matchCount === 5 && matchBonus) return { rank: '🥈 2등 당첨!', grade: 2, color: '#d97706', bg: '#fef3c7' };
    if (matchCount === 5) return { rank: '🥉 3등 당첨', grade: 3, color: '#2563eb', bg: '#eff6ff' };
    if (matchCount === 4) return { rank: '🎁 4등 (5만원)', grade: 4, color: '#059669', bg: '#ecfdf5' };
    if (matchCount === 3) return { rank: '🎟️ 5등 (5천원)', grade: 5, color: '#4f46e5', bg: '#eef2ff' };
    return { rank: `${matchCount}개 일치 (낙첨)`, grade: 0, color: '#64748b', bg: '#f1f5f9' };
  };

  const calculateHistoricalWins = (gameNumbers) => {
    const counts = { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 };
    for (let round = 1; round <= latestRound; round++) {
      const roundData = getLottoNumbersByRound(round);
      if (!roundData || roundData.isPending) continue;
      const result = checkSingleRoundResult(gameNumbers, roundData.numbers, roundData.bnusNo);
      if (result.grade > 0) {
        counts.total += 1;
        if (result.grade === 1) counts.r1 += 1;
        else if (result.grade === 2) counts.r2 += 1;
        else if (result.grade === 3) counts.r3 += 1;
        else if (result.grade === 4) counts.r4 += 1;
        else if (result.grade === 5) counts.r5 += 1;
      }
    }
    return counts;
  };

  const handleExportPDF = async () => {
    if (savedSets.length === 0) {
      Alert.alert('알림', '저장된 로또 번호가 없습니다.');
      return;
    }

    const rowsHtml = savedSets
      .map((item) => {
        const gamesHtml = item.games
          .map((g, gIdx) => {
            const label = item.games.length === 1 ? '수동' : gameLabels[gIdx];
            const hist = calculateHistoricalWins(g);
            const ballsHtml = g
              .map(
                (n) => `
                  <span style="display:inline-block; width:26px; height:26px; line-height:26px; border-radius:50%; background-color:${getBallColor(
                    n
                  )}; color:#fff; text-align:center; font-weight:bold; font-size:12px; margin:0 2px;">
                    ${n}
                  </span>`
              )
              .join('');

            return `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 6px; font-weight: bold; text-align: center; color: #1e293b;">${label}</td>
                <td style="padding: 8px 6px;">${ballsHtml}</td>
                <td style="padding: 8px 6px; font-size: 11px; color: #475569; text-align: center;">
                  <strong>총 ${hist.total}회</strong><br/>
                  (1등:${hist.r1} / 2등:${hist.r2} / 3등:${hist.r3} / 4등:${hist.r4} / 5등:${hist.r5})
                </td>
              </tr>`;
          })
          .join('');

        return `
          <div style="margin-bottom: 18px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff;">
            <div style="background-color: #f1f5f9; padding: 8px 12px; font-size: 13px; font-weight: bold; color: #334155;">
              📅 저장일시: ${item.date}
            </div>
            <table style="width: 100%; border-collapse: collapse; font-family: sans-serif;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
                  <th style="padding: 6px; width: 14%;">구분</th>
                  <th style="padding: 6px; width: 50%;">로또 번호</th>
                  <th style="padding: 6px; width: 36%;">역대 당첨 횟수</th>
                </tr>
              </thead>
              <tbody>
                ${gamesHtml}
              </tbody>
            </table>
          </div>`;
      })
      .join('');

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>로또 저장번호 목록</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #0f172a; }
            h1 { font-size: 20px; text-align: center; color: #1e3a8a; margin-bottom: 4px; }
            .sub-title { font-size: 12px; text-align: center; color: #64748b; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <h1>🎰 나의 로또 보관함 번호 목록</h1>
          <div class="sub-title">기준 회차: 제${latestRound}회 (공식 서버 동기화)</div>
          ${rowsHtml}
        </body>
      </html>`;

    try {
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(fullHtml);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
        }
      } else {
        await Print.printAsync({ html: fullHtml });
      }
    } catch (e) {
      Alert.alert('인쇄 오류', 'PDF 인쇄 창을 여는 중 문제가 발생했습니다.');
    }
  };

  const handleExportExcel = async () => {
    if (savedSets.length === 0) {
      Alert.alert('알림', '저장된 로또 번호가 없습니다.');
      return;
    }

    let csvString = '\uFEFF저장일시,게임구분,번호1,번호2,번호3,번호4,번호5,번호6,역대총당첨,1등,2등,3등,4등,5등\n';
    savedSets.forEach((item) => {
      item.games.forEach((g, gIdx) => {
        const label = item.games.length === 1 ? '수동' : gameLabels[gIdx];
        const hist = calculateHistoricalWins(g);
        const safeDate = item.date.replace(/,/g, '');
        csvString += `"${safeDate}","${label}",${g[0]},${g[1]},${g[2]},${g[3]},${g[4]},${g[5]},${hist.total},${hist.r1},${hist.r2},${hist.r3},${hist.r4},${hist.r5}\n`;
      });
    });

    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `lotto_saved_numbers_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const fileUri = `${FileSystem.cacheDirectory}lotto_saved_numbers_${Date.now()}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csvString, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const isSharingAvailable = await Sharing.isAvailableAsync();
        if (isSharingAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: '로또 번호 엑셀(CSV) 내보내기',
            UTI: 'public.comma-separated-values-text',
          });
        } else {
          Alert.alert('알림', '파일 공유 기능을 지원하지 않는 기기입니다.');
        }
      }
    } catch (e) {
      Alert.alert('내보내기 오류', '엑셀 파일을 생성하는 중 문제가 발생했습니다.');
    }
  };

  // [수정 핵심] QR 스캐너 열기: 세로 모드 강제 고정 보장
  const handleOpenQrScanner = async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLockPlatform.PORTRAIT_UP);
    } catch (err) {
      console.log('방향 락 에러:', err);
    }

    if (!permission || !permission.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('카메라 권한 필요', '로또 QR코드를 스캔하려면 카메라 권한을 허용해주세요.');
        return;
      }
    }
    setScanned(false);
    setIsCameraModalVisible(true);
  };

  // [수정 핵심] QR 스캐너 닫기: 세로 모드 유지
  const handleCloseQrScanner = async () => {
    setIsCameraModalVisible(false);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLockPlatform.PORTRAIT_UP);
    } catch (err) {
      console.log('방향 유지 에러:', err);
    }
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);

    if (data.includes('dhlottery.co.kr') && (data.includes('?v=') || data.includes('&v='))) {
      const parsed = parseLottoQrUrl(data);

      if (!parsed) {
        Alert.alert('인식 오류', '유효한 로또 복권 QR 코드가 아닙니다.', [
          { text: '다시 스캔', onPress: () => setScanned(false) },
        ]);
        return;
      }

      try {
        let winInfo = getLottoNumbersByRound(parsed.round);
        if (winInfo.isPending) {
          const fetched = await fetchLottoRoundWithFallback(parsed.round);
          if (fetched) {
            winInfo = { ...fetched, isPending: false };
            const updated = { ...lottoCache, [fetched.drwNo]: winInfo };
            setLottoCache(updated);
            await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(updated));
          }
        }

        const gameResults = parsed.games.map((g) =>
          checkSingleRoundResult(g, winInfo.numbers, winInfo.bnusNo)
        );

        setQrResultData({
          round: parsed.round,
          games: parsed.games,
          winningInfo: winInfo,
          results: gameResults,
        });

        handleCloseQrScanner();
        setIsQrResultModalVisible(true);
      } catch (e) {
        Alert.alert('대조 오류', '당첨결과를 확인하는 중 문제가 발생했습니다.', [
          { text: '다시 시도', onPress: () => setScanned(false) },
        ]);
      }
    } else if (data.startsWith('http://') || data.startsWith('https://')) {
      Alert.alert('외부 링크 인식', data, [
        { text: '다시 스캔', onPress: () => setScanned(false) },
        {
          text: '브라우저 열기',
          onPress: () => {
            handleCloseQrScanner();
            Linking.openURL(data);
          },
        },
      ]);
    } else {
      Alert.alert('인식 결과', data, [{ text: '다시 스캔', onPress: () => setScanned(false) }]);
    }
  };

  const openInNaverSearch = (round = null) => {
    const query = round ? `로또645 ${round}회 1등판매점` : '로또645 1등판매점';
    Linking.openURL(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}`);
  };

  const handleSearchWinningRound = () => {
    const r = parseInt(searchRoundInput.trim(), 10);
    if (r >= 1 && r <= latestRound) {
      setWinningTopRound(r);
      setSearchRoundInput('');
    } else {
      Alert.alert('입력 오류', `1회부터 ${latestRound}회 사이 숫자를 입력해 주세요.`);
    }
  };

  const handleGenerateWithOptions = useCallback(
    (optionType) => {
      const availableCount = 45 - excludedNumbers.length;
      if (availableCount < 6) {
        Alert.alert('알림', '제외수가 너무 많습니다. 최소 6개 이상의 후보 번호가 필요합니다.');
        return;
      }

      setActiveGenOption(optionType);
      let newGames = [];
      let title = '';

      if (optionType === 'NORMAL') {
        newGames = Array.from({ length: 5 }, () => generateBasicLottoSet(excludedNumbers));
        title = '🎲 기본 무작위 5세트 생성';
      } else if (optionType === 'OPT_STRICT') {
        newGames = Array.from({ length: 5 }, () => generateStrictFilteredSet(excludedNumbers));
        title = '📊 12대 정밀 필터링 5세트 생성';
      }

      setGames(newGames);
      setGenerationTitle(title);
      setIsGeneratedModalVisible(true);
    },
    [excludedNumbers, generateStrictFilteredSet]
  );

  const handleGenerateOpposite = () => {
    if (savedSets.length === 0) {
      Alert.alert('알림', '저장된 번호가 없습니다. 먼저 번호를 저장해주세요.');
      return;
    }

    const savedNumbersSet = new Set();
    savedSets.forEach((entry) => {
      entry.games.forEach((g) => {
        g.forEach((num) => savedNumbersSet.add(num));
      });
    });

    const oppositePool = Array.from({ length: 45 }, (_, i) => i + 1).filter(
      (n) => !savedNumbersSet.has(n) && !excludedNumbers.includes(n)
    );

    if (oppositePool.length < 6) {
      Alert.alert(
        '반대번호 생성 불가',
        `저장된 번호를 제외하고 남은 번호가 부족합니다. 최소 6개 이상이어야 합니다.`
      );
      return;
    }

    const newGames = Array.from({ length: 5 }, () => {
      const selected = new Set();
      const tempPool = [...oppositePool];
      while (selected.size < 6 && tempPool.length > 0) {
        const rIdx = Math.floor(Math.random() * tempPool.length);
        selected.add(tempPool[rIdx]);
        tempPool.splice(rIdx, 1);
      }
      return Array.from(selected).sort((a, b) => a - b);
    });

    setGames(newGames);
    setGenerationTitle(`⚡ 반대번호 생성 (후보 ${oppositePool.length}개)`);
    setIsSavedModalVisible(false);
    setIsGeneratedModalVisible(true);
  };

  const handleSaveCurrentGames = async () => {
    if (games.length === 0) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
      now.getDate()
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newEntry = { id: Date.now().toString(), date: dateStr, games: games };
    try {
      const updated = [newEntry, ...savedSets];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedSets(updated);
      Alert.alert('저장 완료', '생성된 5세트 번호가 기기에 저장되었습니다.');
    } catch (e) {
      Alert.alert('저장 실패', '번호를 저장하는 중 문제가 발생했습니다.');
    }
  };

  const handleDeleteSingleGame = (itemId, gameIdx) => {
    Alert.alert('1게임 삭제', '선택하신 게임 번호를 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            const updated = savedSets
              .map((item) => {
                if (item.id === itemId) {
                  const remainingGames = item.games.filter((_, idx) => idx !== gameIdx);
                  return { ...item, games: remainingGames };
                }
                return item;
              })
              .filter((item) => item.games.length > 0);

            setSavedSets(updated);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            Alert.alert('삭제 오류', '게임을 삭제하는 중 문제가 발생했습니다.');
          }
        },
      },
    ]);
  };

  const handleDeleteAllSavedSets = () => {
    if (savedSets.length === 0) {
      Alert.alert('알림', '삭제할 저장 번호가 없습니다.');
      return;
    }

    Alert.alert(
      '⚠️ 전체 삭제 확인',
      '보관함에 저장된 모든 로또 번호를 완전히 삭제하시겠습니까?\n삭제된 번호는 복구할 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '모두 삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              setSavedSets([]);
              await AsyncStorage.removeItem(STORAGE_KEY);
              Alert.alert('삭제 완료', '모든 저장 번호가 깨끗이 삭제되었습니다.');
            } catch (e) {
              Alert.alert('오류', '전체 삭제 중 문제가 발생했습니다.');
            }
          },
        },
      ]
    );
  };

  const latestWinningInfo = getLottoNumbersByRound(latestRound);
  const recent3WeeksData = getDynamicContextData();
  const analytics10 = get10ExclusionAnalytics();

  return (
    <View style={styles.fullScreenContainer}>
      <StatusBar style="dark" translucent={true} backgroundColor="transparent" />

      <ImageBackground
        source={require('./assets/main_bg.png')}
        style={styles.backgroundImage}
        resizeMode="stretch"
      >
        <TouchableOpacity
          style={styles.goldCoinTrigger}
          onPress={() => handleGenerateWithOptions(activeGenOption)}
          activeOpacity={0.65}
        />

        <View style={styles.menuGridContainer}>
          <View style={styles.menuGridRow}>
            {/* 1. 당첨번호 조회 */}
            <TouchableOpacity
              style={styles.menuGridItem}
              onPress={() => {
                setWinningTopRound(latestRound);
                setIsWinningModalVisible(true);
              }}
              activeOpacity={0.6}
            />
            {/* 2. 제외수 설정 */}
            <TouchableOpacity
              style={styles.menuGridItem}
              onPress={() => setIsExcludeModalVisible(true)}
              activeOpacity={0.6}
            />
          </View>

          <View style={styles.menuGridRow}>
            {/* 3. 저장된 번호 보관함 */}
            <TouchableOpacity
              style={styles.menuGridItem}
              onPress={() => setIsSavedModalVisible(true)}
              activeOpacity={0.6}
            >
              {totalSavedGamesCount > 0 && (
                <View style={styles.mainBadgeCounter}>
                  <Text style={styles.mainBadgeCounterText}>
                    {totalSavedGamesCount > 99 ? '99+' : totalSavedGamesCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* 4. QR 스캔 */}
            <TouchableOpacity
              style={styles.menuGridItem}
              onPress={handleOpenQrScanner}
              activeOpacity={0.6}
            />
          </View>
        </View>
      </ImageBackground>

      {/* [모달 2] 5세트 추첨 결과 모달 */}
      <Modal
        visible={isGeneratedModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsGeneratedModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.bottomModalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{generationTitle}</Text>
                <Text style={styles.modalSubtitle}>
                  {activeGenOption === 'OPT_STRICT'
                    ? `12대 정밀 필터 적용 (소수 1~3개 허용)`
                    : '제외수 반영 무작위 6개 추출'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsGeneratedModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.manualTopOptionBtn}
              onPress={() => {
                setIsGeneratedModalVisible(false);
                setManualSelectedNumbers([]);
                setIsManualModalVisible(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.manualTopOptionBtnText}>✏️ 직접 번호 생성 (수동 6자리 선택)</Text>
            </TouchableOpacity>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {games.map((game, gIdx) => (
                <View key={`game-${gIdx}`} style={styles.gameCard}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{gameLabels[gIdx]}</Text>
                  </View>
                  <View style={styles.ballsRow}>
                    {game.map((num) => (
                      <View
                        key={`b-${num}`}
                        style={[styles.ball, { backgroundColor: getBallColor(num) }]}
                      >
                        <Text style={styles.ballText}>{num}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.twoOptionBtnRow}>
              <TouchableOpacity
                style={[styles.bottomOptionBtn, styles.strictOptionBtn]}
                onPress={() => handleGenerateWithOptions('OPT_STRICT')}
                activeOpacity={0.85}
              >
                <Text style={styles.bottomOptionBtnTitle}>📊 12대 정밀 필터링</Text>
                <Text style={styles.bottomOptionBtnSub}>(소수 최대 3개·이월·멸패턴 완벽적용)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bottomOptionBtn, styles.normalOptionBtn]}
                onPress={() => handleGenerateWithOptions('NORMAL')}
                activeOpacity={0.85}
              >
                <Text style={styles.bottomOptionBtnTitle}>🎲 기본추첨</Text>
                <Text style={styles.bottomOptionBtnSub}>(5세트 무작위 생성)</Text>
              </TouchableOpacity>
            </View>

            {savedSets.length > 0 && (
              <TouchableOpacity style={styles.oppositeActionBtn} onPress={handleGenerateOpposite}>
                <Text style={styles.oppositeActionBtnText}>⚡ 저장된 번호 제외하고 '반대번호' 생성</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalFooterRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCurrentGames}>
                <Text style={styles.btnTextWhite}>💾 기기에 저장</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsGeneratedModalVisible(false)}>
                <Text style={styles.btnTextWhite}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* [모달 3] 저장한 번호 목록 모달 (전체화면) */}
      <Modal
        visible={isSavedModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsSavedModalVisible(false)}
      >
        <SafeAreaView style={styles.fullScreenModalContainer}>
          <View style={styles.fullScreenModalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.modalTitle}>📂 내가 저장한 번호 목록</Text>
              <View style={styles.savedModalCounterBadge}>
                <Text style={styles.savedModalCounterBadgeText}>총 {totalSavedGamesCount}개</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setIsSavedModalVisible(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.modalSubtitle, { marginHorizontal: 16, marginBottom: 10 }]}>
            최신 제{latestRound}회 결과 및 누적 당첨 분석
          </Text>

          <View style={[styles.exportButtonGroup, { marginHorizontal: 16 }]}>
            <TouchableOpacity style={styles.exportPdfBtn} onPress={handleExportPDF} activeOpacity={0.8}>
              <Text style={styles.exportPdfBtnText}>📄 PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exportExcelBtn} onPress={handleExportExcel} activeOpacity={0.8}>
              <Text style={styles.exportExcelBtnText}>📊 엑셀</Text>
            </TouchableOpacity>
            {savedSets.length > 0 && (
              <TouchableOpacity style={styles.deleteAllSavedBtn} onPress={handleDeleteAllSavedSets} activeOpacity={0.8}>
                <Text style={styles.deleteAllSavedBtnText}>🗑️ 전체삭제</Text>
              </TouchableOpacity>
            )}
          </View>

          {savedSets.length > 0 && (
            <View style={{ marginHorizontal: 16 }}>
              <TouchableOpacity style={styles.oppositeBannerBtn} onPress={handleGenerateOpposite} activeOpacity={0.85}>
                <Text style={styles.oppositeBannerBtnTitle}>⚡ 저장 안 된 번호로만 뽑기</Text>
                <Text style={styles.oppositeBannerBtnSub}>[반대번호] 5세트 생성 ➔</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.winningReferenceBar, { marginHorizontal: 16 }]}>
            <View style={styles.winningRefHeaderRow}>
              <Text style={styles.winningReferenceTitle}>
                최신 기준: 제{latestRound}회 ({latestWinningInfo.drwNoDate})
              </Text>
              <TouchableOpacity style={styles.smallRefreshTouch} onPress={handleRefreshLatestRound} disabled={isRefreshing}>
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <Text style={styles.smallRefreshTouchText}>🔄 새로고침</Text>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.winningRefBallsRow}>
              {latestWinningInfo.numbers.map((n) => (
                <View key={`ref-${n}`} style={[styles.refBall, { backgroundColor: getBallColor(n) }]}>
                  <Text style={styles.refBallText}>{n}</Text>
                </View>
              ))}
              <Text style={styles.refPlus}>+</Text>
              <View style={[styles.refBall, { backgroundColor: getBallColor(latestWinningInfo.bnusNo) }]}>
                <Text style={styles.refBallText}>{latestWinningInfo.bnusNo}</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.fullScreenScroll} showsVerticalScrollIndicator={false}>
            {savedSets.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>저장된 로또 번호가 없습니다.</Text>
                <Text style={styles.emptySubText}>번호를 생성한 후 '기기에 저장'을 눌러보세요!</Text>
              </View>
            ) : (
              savedSets.map((item) => (
                <View key={item.id} style={styles.savedCard}>
                  <View style={styles.savedCardHeader}>
                    <Text style={styles.savedDate}>📅 {item.date}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert('세트 삭제', '이 묶음의 번호를 모두 삭제하시겠습니까?', [
                          { text: '취소', style: 'cancel' },
                          {
                            text: '삭제',
                            style: 'destructive',
                            onPress: async () => {
                              const updated = savedSets.filter((s) => s.id !== item.id);
                              setSavedSets(updated);
                              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                            },
                          },
                        ]);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.delText}>묶음삭제</Text>
                    </TouchableOpacity>
                  </View>

                  {item.games.map((g, gIdx) => {
                    const lastResult = checkSingleRoundResult(
                      g,
                      latestWinningInfo.numbers,
                      latestWinningInfo.bnusNo
                    );
                    const hist = calculateHistoricalWins(g);
                    const gameLabel = item.games.length === 1 ? '수동' : gameLabels[gIdx];

                    return (
                      <View key={`saved-${item.id}-${gIdx}`} style={styles.savedGameItem}>
                        <View style={styles.savedRowTop}>
                          <View style={styles.gameTopLeftGroup}>
                            <View style={styles.miniBadge}>
                              <Text style={styles.miniBadgeText}>{gameLabel}</Text>
                            </View>
                            <View style={[styles.resultBadge, { backgroundColor: lastResult.bg }]}>
                              <Text style={[styles.resultBadgeText, { color: lastResult.color }]}>
                                {lastResult.rank}
                              </Text>
                            </View>
                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <TouchableOpacity
                              style={styles.analysisSmallBtn}
                              onPress={() => {
                                const flatList = getFlatSavedGames();
                                const foundIdx = flatList.findIndex((fg) => fg.id === item.id && fg.gIdx === gIdx);
                                const analysisResult = calculateNumbersAnalysis(
                                  g,
                                  latestRound,
                                  `저장 번호 정밀 분석 (${gameLabel})`,
                                  `저장일시: ${item.date} | 최신 제${latestRound}회 공식 기준 심층 분석`,
                                  null,
                                  'SAVED',
                                  foundIdx !== -1 ? foundIdx : 0
                                );
                                setAnalysisTargetData(analysisResult);
                                setIsAnalysisModalVisible(true);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.analysisSmallBtnText}>📊 정밀분석</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.singleGameDeleteTouch}
                              onPress={() => handleDeleteSingleGame(item.id, gIdx)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.singleGameDeleteText}>✕ 삭제</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        <View style={styles.savedBallsRow}>
                          {g.map((n) => {
                            const isMatched = latestWinningInfo.numbers.includes(n);
                            const isBonusMatched = n === latestWinningInfo.bnusNo;
                            return (
                              <View
                                key={`s-ball-${n}`}
                                style={[
                                  styles.miniBall,
                                  { backgroundColor: getBallColor(n) },
                                  isMatched && styles.matchedBallHighlight,
                                  isBonusMatched && styles.bonusBallHighlight,
                                ]}
                              >
                                <Text style={styles.miniBallText}>{n}</Text>
                                {isMatched && <Text style={styles.matchMark}>✓</Text>}
                                {isBonusMatched && <Text style={styles.bonusMark}>B</Text>}
                              </View>
                            );
                          })}
                        </View>

                        <View style={styles.historyStatsBox}>
                          <Text style={styles.historyStatsTitle}>
                            📊 동행복권 누적 당첨 횟수:
                            <Text style={styles.historyTotalText}> 총 {hist.total}회</Text>
                          </Text>
                          <Text style={styles.historyDetailText}>
                            (1등: {hist.r1}회 / 2등: {hist.r2}회 / 3등: {hist.r3}회 / 4등: {hist.r4}회 / 5등: {hist.r5}회)
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsSavedModalVisible(false)}>
              <Text style={styles.btnTextWhite}>닫기</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* [모달 4] 10대 알고리즘 기반 제외수 설정 모달 (12대 생성필터 탭 삭제 완료) */}
      <Modal
        visible={isExcludeModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsExcludeModalVisible(false)}
      >
        <View style={styles.centerModalOverlay}>
          <View style={styles.excludePopupBox}>
            <View style={styles.excludeHeaderBox}>
              <Text style={styles.excludeHeaderTitle}>🚫 10대 알고리즘 제외수 설정</Text>
              <TouchableOpacity
                onPress={() => setIsExcludeModalVisible(false)}
                style={styles.excludeCloseTouch}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.excludeCloseX}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.excludeCountBar}>
              <Text style={styles.excludeCountText}>
                현재 설정된 제외수: <Text style={styles.excludeCountHighlight}>{excludedNumbers.length}개</Text> (권장: 10~14개)
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <View style={styles.smartFormulaPanel}>
                {/* 10대 알고리즘 종합 12개 자동 추천 버튼 */}
                <TouchableOpacity
                  style={styles.smartAuto12Btn}
                  onPress={applySmart10AlgorithmSet}
                  activeOpacity={0.85}
                >
                  <Text style={styles.smartAuto12BtnTitle}>⚡ 10대 알고리즘 정밀 제외수 12개 자동 도출</Text>
                  <Text style={styles.smartAuto12BtnSub}>
                    (장·단기 미출 + 과열 + 출현주기 + 추세 + 끝수·구간 종합 가중 평가)
                  </Text>
                </TouchableOpacity>

                <Text style={styles.algoSectionHeaderTitle}>
                  📋 10가지 제외 알고리즘 개별 실행 (터치 시 제외수 즉시 등록):
                </Text>

                {/* 10대 알고리즘 개별 버튼 그리드 */}
                <View style={styles.algoButtonsGrid}>
                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo1_LongCold, '① 장기 미출현 (30주↑)')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>① 장기 미출현</Text>
                    <Text style={styles.algoGridBtnSub}>30주 이상 미출 ({analytics10.algo1_LongCold.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo2_ShortCold, '② 단기 미출현 (10주간 0회)')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>② 단기 미출현</Text>
                    <Text style={styles.algoGridBtnSub}>최근 10주간 0회 ({analytics10.algo2_ShortCold.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo3_LowFreq, '③ 출현 빈도 저빈도 (30주 1회↓)')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>③ 저출현 빈도</Text>
                    <Text style={styles.algoGridBtnSub}>30주 1회 이하 ({analytics10.algo3_LowFreq.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo4_Overheated, '④ 과다 출현 (5주3회↑/10주4회↑)')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>④ 과다 출현수</Text>
                    <Text style={styles.algoGridBtnSub}>단기 과열수 ({analytics10.algo4_Overheated.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo5_CycleOutlier, '⑤ 출현 주기 이탈')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>⑤ 출현 주기 이탈</Text>
                    <Text style={styles.algoGridBtnSub}>평균 주기 급단기 ({analytics10.algo5_CycleOutlier.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo6_Trend, '⑥ 최근 연속추세 (2연속 출현)')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>⑥ 최근 연속추세</Text>
                    <Text style={styles.algoGridBtnSub}>2주 연속 당첨 ({analytics10.algo6_Trend.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo7_SameEnd, '⑦ 끝수 과밀 편중')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>⑦ 끝수 과밀 편중</Text>
                    <Text style={styles.algoGridBtnSub}>직전 2개이상 끝수 ({analytics10.algo7_SameEnd.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo8_Section, '⑧ 구간 과밀 편중')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>⑧ 구간 과밀 편중</Text>
                    <Text style={styles.algoGridBtnSub}>직전 3개이상 구간 ({analytics10.algo8_Section.length}개)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.algoGridBtn}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo9_LastDraw, '⑨ 직전 회차 6개')}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.algoGridBtnTitle}>⑨ 직전 회차 전체</Text>
                    <Text style={styles.algoGridBtnSub}>직전 당첨번호 6개 일괄</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.algoGridBtn, { borderColor: '#b91c1c', backgroundColor: '#fff1f2' }]}
                    onPress={() => handleApplySingleAlgorithm(analytics10.algo10_TopScores, '⑩ 종합 페널티 상위')}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.algoGridBtnTitle, { color: '#9f1239' }]}>⑩ 종합 페널티 상위</Text>
                    <Text style={[styles.algoGridBtnSub, { color: '#be123c' }]}>가중치 위험 상위군</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 1~45 전체 로또 볼 선택 영역 */}
              <View style={styles.excludeBallWrapper}>
                {allNumbers.map((num) => {
                  const isExcluded = excludedNumbers.includes(num);

                  return (
                    <TouchableOpacity
                      key={`ex-ball-${num}`}
                      style={[
                        styles.standardLottoBall,
                        { backgroundColor: getBallColor(num) },
                        isExcluded && styles.standardLottoBallExcluded,
                      ]}
                      onPress={() => toggleExcludeNumber(num)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.standardLottoBallText,
                          isExcluded && styles.standardLottoBallTextExcluded,
                        ]}
                      >
                        {num}
                      </Text>

                      {isExcluded && (
                        <View style={styles.ballStrikeBadge}>
                          <Text style={styles.ballStrikeX}>✕</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.excludePopupBtnRow}>
              <TouchableOpacity
                style={styles.excludeConfirmOrangeBtn}
                onPress={() => setIsExcludeModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnTextWhiteBold}>확인</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.excludeInvertPurpleBtn}
                onPress={handleInvertExcludeNumbers}
                activeOpacity={0.8}
              >
                <Text style={styles.btnTextWhiteBold}>🔄 반전선택</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.excludeResetBlueBtn}
                onPress={() => setExcludedNumbers([])}
                activeOpacity={0.8}
              >
                <Text style={styles.btnTextWhiteBold}>전체해제</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* [모달 5] 직접 번호 생성(수동 선택) 모달 */}
      <Modal
        visible={isManualModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsManualModalVisible(false)}
      >
        <View style={styles.centerModalOverlay}>
          <View style={styles.excludePopupBox}>
            <View style={[styles.excludeHeaderBox, { backgroundColor: '#0f172a' }]}>
              <Text style={[styles.excludeHeaderTitle, { color: '#ffffff' }]}>직접 번호 생성</Text>
              <TouchableOpacity
                onPress={() => setIsManualModalVisible(false)}
                style={styles.excludeCloseTouch}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.excludeCloseX, { color: '#ffffff' }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.manualSelectionBar}>
              <Text style={styles.manualSelectionBarTitle}>
                선택된 번호 ({manualSelectedNumbers.length}/6):
              </Text>
              <View style={styles.manualMiniBallsPreview}>
                {manualSelectedNumbers.length === 0 ? (
                  <Text style={styles.manualPlaceholderText}>번호 6개를 터치하여 선택해주세요</Text>
                ) : (
                  manualSelectedNumbers.map((num) => (
                    <View key={`sel-${num}`} style={[styles.manualSelectedMiniBall, { backgroundColor: getBallColor(num) }]}>
                      <Text style={styles.manualSelectedMiniBallText}>{num}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.excludeBallWrapper}>
              {allNumbers.map((num) => {
                const isSelected = manualSelectedNumbers.includes(num);
                return (
                  <TouchableOpacity
                    key={`manual-${num}`}
                    style={[
                      styles.standardLottoBall,
                      { backgroundColor: getBallColor(num) },
                      isSelected && styles.manualLottoBallSelected,
                    ]}
                    onPress={() => toggleManualNumber(num)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.standardLottoBallText}>{num}</Text>
                    {isSelected && (
                      <View style={styles.manualSelectedBadge}>
                        <Text style={styles.manualSelectedBadgeCheck}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.excludePopupBtnRow}>
              <TouchableOpacity
                style={[styles.excludeConfirmOrangeBtn, { backgroundColor: '#059669' }]}
                onPress={handleSaveManualNumbers}
                activeOpacity={0.8}
              >
                <Text style={styles.btnTextWhiteBold}>번호 저장하기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.excludeResetBlueBtn, { backgroundColor: '#64748b' }]}
                onPress={() => setManualSelectedNumbers([])}
                activeOpacity={0.8}
              >
                <Text style={styles.btnTextWhiteBold}>초기화</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* [모달 6] 전회차 당첨결과 모달 (전체화면) */}
      <Modal
        visible={isWinningModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsWinningModalVisible(false)}
      >
        <SafeAreaView style={styles.fullScreenModalContainer}>
          <View style={styles.fullScreenModalHeader}>
            <View>
              <Text style={styles.modalTitle}>🎉 당첨번호 조회 (공식 15줄)</Text>
              <Text style={styles.modalSubtitle}>실시간 자동 폴백 & 로컬 캐싱 지원</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity
                style={styles.naverTopIntegratedBtn}
                onPress={() => openInNaverSearch(winningTopRound)}
                activeOpacity={0.8}
              >
                <Text style={styles.naverTopIntegratedBtnText}>📍 1등 판매점</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.headerRefreshBtn}
                onPress={handleRefreshLatestRound}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <Text style={styles.headerRefreshText}>🔄 갱신</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setIsWinningModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.searchRow, { marginHorizontal: 16 }]}>
            <TextInput
              style={styles.searchInput}
              placeholder="기준 회차 입력 (예: 1160, 1000)"
              keyboardType="number-pad"
              value={searchRoundInput}
              onChangeText={setSearchRoundInput}
              onSubmitEditing={handleSearchWinningRound}
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearchWinningRound}>
              <Text style={styles.btnTextWhite}>이동</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.roundBar, { marginHorizontal: 16 }]}>
            <TouchableOpacity
              onPress={() => setWinningTopRound((prev) => Math.max(15, prev - 15))}
              disabled={bottomRound <= 1}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.roundBtnText, bottomRound <= 1 && styles.disabledText]}>
                ◀ 이전 15회
              </Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.currentRoundText}>
                제 {winningTopRound}회 ~ {bottomRound}회
              </Text>
              {isLoadingWinningRounds && <ActivityIndicator size="small" color="#2563eb" />}
            </View>
            <TouchableOpacity
              onPress={() => setWinningTopRound((prev) => Math.min(latestRound, prev + 15))}
              disabled={winningTopRound >= latestRound}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.roundBtnText, winningTopRound >= latestRound && styles.disabledText]}>
                다음 15회 ▶
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.fullScreenScroll} showsVerticalScrollIndicator={true}>
            {displayed15Rounds.map((r) => {
              const roundData = getLottoNumbersByRound(r);

              return (
                <View key={`round-card-${r}`} style={styles.roundItemCard}>
                  <View style={styles.roundItemTopRow}>
                    <View style={styles.roundItemInfo}>
                      <Text style={styles.roundNumberBadge}>제 {r} 회</Text>
                      <Text style={styles.roundItemDateText}>{roundData.drwNoDate}</Text>
                      {roundData.isPending && (
                        <Text style={{ fontSize: 10, color: '#f59e0b', fontWeight: 'bold' }}>
                          (동기화 중...)
                        </Text>
                      )}
                    </View>
                    <View style={styles.roundItemActionsRow}>
                      <TouchableOpacity
                        style={styles.analysisSmallBtn}
                        onPress={() => {
                          if (roundData.isPending) {
                            Alert.alert('알림', '공식 당첨번호를 불러오는 중입니다. 잠시 후 다시 터치해 주세요.');
                            return;
                          }
                          const analysisResult = calculateNumbersAnalysis(
                            roundData.numbers,
                            r,
                            `제 ${r}회 당첨번호 정밀 분석`,
                            `${roundData.drwNoDate} 공식 결과 심층 데이터 분석`,
                            roundData.bnusNo,
                            'WINNING',
                            r
                          );
                          setAnalysisTargetData(analysisResult);
                          setIsAnalysisModalVisible(true);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.analysisSmallBtnText}>📊 정밀분석</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.miniBallsRow}>
                    {roundData.numbers.map((n, idx) => (
                      <View
                        key={`wb-${r}-${idx}`}
                        style={[
                          styles.listMiniBall,
                          { backgroundColor: roundData.isPending ? '#cbd5e1' : getBallColor(n) },
                        ]}
                      >
                        <Text style={styles.listMiniBallText}>{roundData.isPending ? '?' : n}</Text>
                      </View>
                    ))}
                    <Text style={styles.miniPlusSign}>+</Text>
                    <View
                      style={[
                        styles.listMiniBall,
                        { backgroundColor: roundData.isPending ? '#cbd5e1' : getBallColor(roundData.bnusNo) },
                      ]}
                    >
                      <Text style={styles.listMiniBallText}>{roundData.isPending ? '?' : roundData.bnusNo}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsWinningModalVisible(false)}>
              <Text style={styles.btnTextWhite}>닫기</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* [모달 7] 당첨번호 & 저장번호 정밀 분석 대시보드 */}
      <Modal
        visible={isAnalysisModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAnalysisModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.bottomModalContainer, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {analysisTargetData?.titleText || '📊 로또 번호 정밀 분석'}
                </Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {analysisTargetData?.subText}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsAnalysisModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {analysisTargetData?.sourceType === 'WINNING' && (
              <View style={styles.analysisNavSubBar}>
                <TouchableOpacity
                  style={[
                    styles.analysisNavBtn,
                    analysisTargetData.sourceIndex <= 1 && styles.analysisNavBtnDisabled,
                  ]}
                  onPress={() => navigateWinningAnalysis(analysisTargetData.sourceIndex - 1)}
                  disabled={analysisTargetData.sourceIndex <= 1}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.analysisNavBtnText,
                      analysisTargetData.sourceIndex <= 1 && styles.analysisNavBtnTextDisabled,
                    ]}
                  >
                    ◀ 이전회차
                  </Text>
                </TouchableOpacity>

                <View style={styles.analysisNavCenterInfo}>
                  <Text style={styles.analysisNavRoundBadge}>
                    제 {analysisTargetData.sourceIndex} 회차
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.analysisNavBtn,
                    analysisTargetData.sourceIndex >= latestRound && styles.analysisNavBtnDisabled,
                  ]}
                  onPress={() => navigateWinningAnalysis(analysisTargetData.sourceIndex + 1)}
                  disabled={analysisTargetData.sourceIndex >= latestRound}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.analysisNavBtnText,
                      analysisTargetData.sourceIndex >= latestRound && styles.analysisNavBtnTextDisabled,
                    ]}
                  >
                    다음회차 ▶
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 저장번호 정밀분석: 현재 번호 옆에 [🗑️ 삭제] 버튼 */}
            {analysisTargetData?.sourceType === 'SAVED' && (
              <View style={styles.analysisNavSubBar}>
                <TouchableOpacity
                  style={[
                    styles.analysisNavBtn,
                    analysisTargetData.sourceIndex <= 0 && styles.analysisNavBtnDisabled,
                  ]}
                  onPress={() => navigateSavedAnalysis(analysisTargetData.sourceIndex - 1)}
                  disabled={analysisTargetData.sourceIndex <= 0}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.analysisNavBtnText,
                      analysisTargetData.sourceIndex <= 0 && styles.analysisNavBtnTextDisabled,
                    ]}
                  >
                    ◀ 이전 번호
                  </Text>
                </TouchableOpacity>

                <View style={styles.analysisNavCenterInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.analysisNavRoundBadge}>
                      {analysisTargetData.sourceIndex + 1} / {getFlatSavedGames().length}
                    </Text>
                    <TouchableOpacity
                      style={styles.analysisDeleteBtn}
                      onPress={() => handleDeleteGameFromAnalysis(analysisTargetData.sourceIndex)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.analysisDeleteBtnText}>🗑️ 삭제</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.analysisNavBtn,
                    analysisTargetData.sourceIndex >= getFlatSavedGames().length - 1 && styles.analysisNavBtnDisabled,
                  ]}
                  onPress={() => navigateSavedAnalysis(analysisTargetData.sourceIndex + 1)}
                  disabled={analysisTargetData.sourceIndex >= getFlatSavedGames().length - 1}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.analysisNavBtnText,
                      analysisTargetData.sourceIndex >= getFlatSavedGames().length - 1 && styles.analysisNavBtnTextDisabled,
                    ]}
                  >
                    다음 번호 ▶
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {analysisTargetData && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {/* 1. 번호 볼 바 */}
                <View style={styles.analysisBallsCard}>
                  <View style={styles.analysisBallsRow}>
                    {analysisTargetData.numbers.map((n) => (
                      <View key={`an-b-${n}`} style={[styles.analysisBall, { backgroundColor: getBallColor(n) }]}>
                        <Text style={styles.analysisBallText}>{n}</Text>
                      </View>
                    ))}
                    {analysisTargetData.bonusNum && (
                      <>
                        <Text style={styles.analysisPlus}>+</Text>
                        <View style={[styles.analysisBall, { backgroundColor: getBallColor(analysisTargetData.bonusNum) }]}>
                          <Text style={styles.analysisBallText}>{analysisTargetData.bonusNum}</Text>
                        </View>
                      </>
                    )}
                  </View>
                </View>

                {/* 2. 용지 마킹 패턴표 */}
                <View style={styles.analysisSectionCard}>
                  <View style={styles.slipCardHeader}>
                    <Text style={styles.analysisSectionTitle}>
                      📋 로또 용지 마킹 패턴표 (7×7 SLIP)
                    </Text>
                    <Text style={styles.slipSubDesc}>
                      {analysisTargetData.sourceType === 'WINNING'
                        ? `제${analysisTargetData.sourceIndex}회 기준 순수 6개 번호 및 직전 주차 비교`
                        : `최신 제${latestRound}회 기준 순수 6개 번호 및 직전 주차 비교`}
                    </Text>
                  </View>

                  <View style={styles.patternToggleControlRow}>
                    <Text style={styles.patternToggleControlLabel}>주차 비교:</Text>

                    <TouchableOpacity
                      style={[styles.patternToggleBtn, showPatternThisWeek && styles.patternToggleBtn1Active]}
                      onPress={() => setShowPatternThisWeek((prev) => !prev)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.patternToggleBtnText, showPatternThisWeek && styles.patternToggleBtnTextActive]}>
                        🔴 {analysisTargetData.sourceType === 'WINNING' ? '당시회차' : '이번주'} {showPatternThisWeek ? 'ON' : 'OFF'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.patternToggleBtn, showPattern1WeekAgo && styles.patternToggleBtn2Active]}
                      onPress={() => setShowPattern1WeekAgo((prev) => !prev)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.patternToggleBtnText, showPattern1WeekAgo && styles.patternToggleBtnTextActive]}>
                        🔵 1주 전 {showPattern1WeekAgo ? 'ON' : 'OFF'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.patternToggleBtn, showPattern2WeeksAgo && styles.patternToggleBtn3Active]}
                      onPress={() => setShowPattern2WeeksAgo((prev) => !prev)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.patternToggleBtnText, showPattern2WeeksAgo && styles.patternToggleBtnTextActive]}>
                        🟢 2주 전 {showPattern2WeeksAgo ? 'ON' : 'OFF'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.slipGridBox}>
                    {Array.from({ length: 7 }, (_, rIdx) => (
                      <View key={`slip-row-${rIdx}`} style={styles.slipGridRow}>
                        {Array.from({ length: 7 }, (_, cIdx) => {
                          const num = rIdx * 7 + cIdx + 1;
                          if (num > 45) {
                            return <View key={`slip-empty-${num}`} style={styles.slipCellEmpty} />;
                          }

                          const isHit = analysisTargetData.numbers.includes(num);

                          const hitThisWeek = showPatternThisWeek && analysisTargetData.numbersThisWeek?.includes(num);
                          const hit1WeekAgo = showPattern1WeekAgo && analysisTargetData.numbers1WeekAgo?.includes(num);
                          const hit2WeeksAgo = showPattern2WeeksAgo && analysisTargetData.numbers2WeeksAgo?.includes(num);

                          return (
                            <View
                              key={`slip-cell-${num}`}
                              style={[
                                styles.slipCell,
                                isHit && styles.slipCellMarked,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.slipCellText,
                                  isHit && styles.slipCellTextMarked,
                                ]}
                              >
                                {num}
                              </Text>

                              {isHit && <View style={styles.slipCheckBar} />}

                              <View style={styles.overlayDotContainer}>
                                {hitThisWeek && <View style={styles.overlayDotRed} />}
                                {hit1WeekAgo && <View style={styles.overlayDotBlue} />}
                                {hit2WeeksAgo && <View style={styles.overlayDotGreen} />}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>

                  <View style={styles.slipStatsPanel}>
                    <View style={styles.slipStatRow}>
                      <Text style={styles.slipStatLabel}>가로줄(1~7행) 출현 분포:</Text>
                      <Text style={styles.slipStatValue}>
                        {analysisTargetData.rowCounts.map((cnt, i) => `${i + 1}행:${cnt}`).join(' | ')}
                      </Text>
                    </View>
                    <View style={styles.slipStatRow}>
                      <Text style={styles.slipStatLabel}>세로줄(1~7열) 출현 분포:</Text>
                      <Text style={styles.slipStatValue}>
                        {analysisTargetData.colCounts.map((cnt, i) => `${i + 1}열:${cnt}`).join(' | ')}
                      </Text>
                    </View>
                    <View style={styles.slipBadgeRow}>
                      <View style={styles.slipDeadBadge}>
                        <Text style={styles.slipDeadBadgeText}>
                          가로 멸(0개) 구간: {analysisTargetData.deadRowCount}개 라인
                        </Text>
                      </View>
                      <View style={styles.slipDeadBadge}>
                        <Text style={styles.slipDeadBadgeText}>
                          세로 멸(0개) 구간: {analysisTargetData.deadColCount}개 라인
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* 3. 5가지 기본 핵심 지표 */}
                <View style={styles.metricGrid}>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>홀짝 비율</Text>
                    <Text style={styles.metricValue}>
                      {analysisTargetData.oddCount} : {analysisTargetData.evenCount}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>번호 총합</Text>
                    <Text style={[styles.metricValue, { color: '#0284c7' }]}>
                      {analysisTargetData.sum}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>고저 비율(22기준)</Text>
                    <Text style={styles.metricValue}>
                      {analysisTargetData.lowCount} : {analysisTargetData.highCount}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>
                      {analysisTargetData.sourceType === 'WINNING' ? '전회차 이월수' : '최신 당첨 일치수'}
                    </Text>
                    <Text style={[styles.metricValue, { color: '#dc2626' }]}>
                      {analysisTargetData.carryOverNumbers.length > 0
                        ? `${analysisTargetData.carryOverNumbers.join(', ')} (${analysisTargetData.carryOverNumbers.length}개)`
                        : '없음 (0개)'}
                    </Text>
                  </View>
                  <View style={styles.metricItemFull}>
                    <Text style={styles.metricLabel}>AC값 (산술적 복잡도 7~10)</Text>
                    <Text
                      style={[
                        styles.metricValue,
                        {
                          color:
                            calculateACValue(analysisTargetData.numbers) >= 7 &&
                            calculateACValue(analysisTargetData.numbers) <= 10
                              ? '#059669'
                              : '#dc2626',
                        },
                      ]}
                    >
                      AC {calculateACValue(analysisTargetData.numbers)} (
                      {calculateACValue(analysisTargetData.numbers) >= 7 &&
                      calculateACValue(analysisTargetData.numbers) <= 10
                        ? '황금 밸런스 유효 범위'
                        : '규칙성 높음/배제 대상'}
                      )
                    </Text>
                  </View>
                </View>

                {/* 4. 특수수 및 핵심 패턴 심층 지표 */}
                <View style={styles.analysisSectionCard}>
                  <Text style={styles.analysisSectionTitle}>
                    🔍 특수수 및 핵심 패턴 심층 지표
                  </Text>

                  <View style={styles.detailMetricGrid}>
                    <View style={styles.detailMetricCard}>
                      <Text style={styles.detailMetricHeader}>소수 & 합성수 (1포함)</Text>
                      <Text style={styles.detailMetricValue}>
                        소수 <Text style={{ color: '#0284c7', fontWeight: '900' }}>{analysisTargetData.primeNumbers.length}개</Text> : 합성수 <Text style={{ color: '#475569', fontWeight: '900' }}>{analysisTargetData.compositeNumbers.length}개</Text>
                      </Text>
                      <Text style={styles.detailMetricSub}>
                        {analysisTargetData.primeNumbers.length > 0 ? `소수: [${analysisTargetData.primeNumbers.join(', ')}]` : '소수 없음'}
                      </Text>
                    </View>

                    <View style={styles.detailMetricCard}>
                      <Text style={styles.detailMetricHeader}>3의 배수 & 5의 배수</Text>
                      <Text style={styles.detailMetricValue}>
                        3배수 <Text style={{ color: '#16a34a', fontWeight: '900' }}>{analysisTargetData.mult3Numbers.length}개</Text> | 5배수 <Text style={{ color: '#d97706', fontWeight: '900' }}>{analysisTargetData.mult5Numbers.length}개</Text>
                      </Text>
                      <Text style={styles.detailMetricSub}>
                        {analysisTargetData.mult5Numbers.length > 0 ? `5배수: [${analysisTargetData.mult5Numbers.join(', ')}]` : '5배수 없음'}
                      </Text>
                    </View>

                    <View style={styles.detailMetricCard}>
                      <Text style={styles.detailMetricHeader}>쌍둥이수 (11,22,33,44)</Text>
                      <Text style={[styles.detailMetricValue, { color: analysisTargetData.twinNumbers.length > 0 ? '#7c3aed' : '#64748b' }]}>
                        {analysisTargetData.twinNumbers.length > 0 ? `총 ${analysisTargetData.twinNumbers.length}개 [${analysisTargetData.twinNumbers.join(', ')}]` : '없음 (0개)'}
                      </Text>
                      <Text style={styles.detailMetricSub}>
                        {analysisTargetData.twinNumbers.length >= 2 ? '⚠️ 과밀 출현' : '안정 밸런스'}
                      </Text>
                    </View>

                    <View style={styles.detailMetricCard}>
                      <Text style={styles.detailMetricHeader}>동일 끝수 중복 현황</Text>
                      <Text style={[styles.detailMetricValue, { color: analysisTargetData.sameEndPairs.length > 0 ? '#dc2626' : '#64748b' }]}>
                        {analysisTargetData.sameEndPairs.length > 0
                          ? analysisTargetData.sameEndPairs.map(([d, list]) => `${d}끝(${list.length}개)`).join(', ')
                          : '끝수 중복 없음'}
                      </Text>
                      <Text style={styles.detailMetricSub}>
                        {analysisTargetData.sameEndPairs.length > 0
                          ? analysisTargetData.sameEndPairs.map(([_, list]) => `[${list.join(',')}]`).join(' ')
                          : '모든 번호 끝수 고유'}
                      </Text>
                    </View>

                    <View style={styles.detailMetricCardFull}>
                      <Text style={styles.detailMetricHeader}>연속번호(연번) 구성</Text>
                      <Text style={[styles.detailMetricValue, { color: analysisTargetData.consecutivePairsList.length > 0 ? '#2563eb' : '#64748b' }]}>
                        {analysisTargetData.consecutivePairsList.length > 0
                          ? `총 ${analysisTargetData.consecutivePairsList.length}쌍 출현 [${analysisTargetData.consecutivePairsList.join(', ')}]`
                          : '연속 번호 없음 (단독 번호)'}
                      </Text>
                    </View>

                    <View style={styles.detailMetricCardFull}>
                      <Text style={styles.detailMetricHeader}>
                        {analysisTargetData.sourceType === 'WINNING'
                          ? `제${analysisTargetData.sourceIndex}회 추첨 당시 핫수 & 콜드수`
                          : `현재 제${latestRound}회 기준 핫수 & 콜드수`}
                      </Text>
                      <View style={styles.hotColdRow}>
                        <View style={styles.hotBadgeBox}>
                          <Text style={styles.hotBadgeTitle}>🔥 핫수 (최단기 출현)</Text>
                          <Text style={styles.hotBadgeNum}>
                            {analysisTargetData.hotNumbersInSet.join(', ')}번
                          </Text>
                          <Text style={styles.hotBadgeSub}>
                            {analysisTargetData.minAbsenceVal === 0
                              ? (analysisTargetData.sourceType === 'WINNING' ? '직전 회차 출현수' : '최신 공식회차 출현수')
                              : `${analysisTargetData.minAbsenceVal}주 만에 출현`}
                          </Text>
                        </View>

                        <View style={styles.coldBadgeBox}>
                          <Text style={styles.coldBadgeTitle}>❄️ 콜드수 (최장기 미출)</Text>
                          <Text style={styles.coldBadgeNum}>
                            {analysisTargetData.coldNumbersInSet.join(', ')}번
                          </Text>
                          <Text style={styles.coldBadgeSub}>
                            {analysisTargetData.maxAbsenceVal === 0
                              ? (analysisTargetData.sourceType === 'WINNING' ? '직전 회차 출현' : '최신 공식회차 출현')
                              : `${analysisTargetData.maxAbsenceVal}주 미출현 후 출현`}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>

                {/* 5. 역대 누적 등수별 당첨 횟수 */}
                <View style={styles.analysisSectionCard}>
                  <Text style={styles.analysisSectionTitle}>
                    🏆 역대 회차 누적 등수별 당첨 횟수
                  </Text>
                  <View style={styles.rankWinsRow}>
                    <View style={styles.rankWinCol}>
                      <Text style={styles.rankWinLabel}>3등 (5개)</Text>
                      <Text style={styles.rankWinValBlue}>{analysisTargetData.rank3Count}회</Text>
                    </View>
                    <View style={styles.rankWinCol}>
                      <Text style={styles.rankWinLabel}>4등 (4개)</Text>
                      <Text style={styles.rankWinValGreen}>{analysisTargetData.rank4Count}회</Text>
                    </View>
                    <View style={styles.rankWinCol}>
                      <Text style={styles.rankWinLabel}>5등 (3개)</Text>
                      <Text style={styles.rankWinValPurple}>{analysisTargetData.rank5Count}회</Text>
                    </View>
                  </View>
                </View>

                {/* 6. 번호별 최근 30회 빈도 및 미출현 주기 */}
                <View style={styles.analysisSectionCard}>
                  <Text style={styles.analysisSectionTitle}>
                    📈 번호별 최근 30회 빈도 및 미출현 주기 ({analysisTargetData.sourceType === 'WINNING' ? `제${analysisTargetData.sourceIndex}회 기준` : `최신 제${latestRound}회 기준`})
                  </Text>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.thText, { width: '22%' }]}>번호</Text>
                    <Text style={[styles.thText, { width: '38%' }]}>최근 30회 출현</Text>
                    <Text style={[styles.thText, { width: '40%' }]}>미출현 텀</Text>
                  </View>
                  {analysisTargetData.numbers.map((n) => (
                    <View key={`freq-row-${n}`} style={styles.tableRow}>
                      <View style={{ width: '22%', flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[styles.microBall, { backgroundColor: getBallColor(n) }]}>
                          <Text style={styles.microBallText}>{n}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdText, { width: '38%', fontWeight: 'bold', color: '#1e3a8a' }]}>
                        {analysisTargetData.recent30Counts[n]}회 출현
                      </Text>
                      <Text style={[styles.tdText, { width: '40%', color: '#475569' }]}>
                        {analysisTargetData.absenceWeeks[n] === 0
                          ? (analysisTargetData.sourceType === 'WINNING' ? '직전 회차 출현' : '최신 회차 출현')
                          : `${analysisTargetData.absenceWeeks[n]}주 만에 출현`}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* 7. 동반 출현 케미 번호 TOP 3 */}
                <View style={styles.analysisSectionCard}>
                  <Text style={styles.analysisSectionTitle}>
                    🤝 번호간 동반 출현 횟수 TOP 3 (케미 번호)
                  </Text>
                  {analysisTargetData.topPairs.map((p, idx) => (
                    <View key={`pair-${idx}`} style={styles.pairRow}>
                      <Text style={styles.pairRankBadge}>{idx + 1}위</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.microBall, { backgroundColor: getBallColor(p.n1) }]}>
                          <Text style={styles.microBallText}>{p.n1}</Text>
                        </View>
                        <Text style={{ fontWeight: 'bold', color: '#64748b' }}>+</Text>
                        <View style={[styles.microBall, { backgroundColor: getBallColor(p.n2) }]}>
                          <Text style={styles.microBallText}>{p.n2}</Text>
                        </View>
                      </View>
                      <Text style={styles.pairCountText}>
                        역대 함께 당첨: <Text style={{ color: '#dc2626', fontWeight: 'bold' }}>{p.count}회</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsAnalysisModalVisible(false)}>
              <Text style={styles.btnTextWhite}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* [모달 8] QR 코드 스캐너 모달 (세로 모드 고정 속성 적용) */}
      <Modal
        visible={isCameraModalVisible}
        animationType="fade"
        supportedOrientations={['portrait']}
        onRequestClose={handleCloseQrScanner}
      >
        <View style={styles.scannerWrapper}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          />

          <SafeAreaView style={styles.scannerOverlay}>
            <View style={styles.scannerHeader}>
              <Text style={styles.scannerHeaderTitle}>QR 스캔</Text>
              <TouchableOpacity
                onPress={handleCloseQrScanner}
                style={styles.scannerCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.scannerCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.scannerBody}>
              <View style={styles.scanTargetBox}>
                <View style={[styles.cornerBracket, styles.bracketTL]} />
                <View style={[styles.cornerBracket, styles.bracketTR]} />
                <View style={[styles.cornerBracket, styles.bracketBL]} />
                <View style={[styles.cornerBracket, styles.bracketBR]} />
              </View>
            </View>

            <View style={styles.scannerFooter}>
              <Text style={styles.scannerGuideText}>QR 코드를 프레임 안에 비춰주세요</Text>
              <Text style={styles.scannerSubGuideText}>자동으로 번호를 판독해 당첨 결과를 실시간 대조합니다</Text>

              <TouchableOpacity
                style={styles.scannerBottomBtn}
                onPress={handleCloseQrScanner}
                activeOpacity={0.75}
              >
                <Text style={styles.scannerBottomBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* [모달 9] QR 코드 당첨 대조 결과 모달 */}
      <Modal
        visible={isQrResultModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsQrResultModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.bottomModalContainer, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>🎫 QR 당첨 확인 결과</Text>
                <Text style={styles.modalSubtitle}>
                  제 {qrResultData?.round}회 복권 대조 (추첨일: {qrResultData?.winningInfo?.drwNoDate || '확인 중'})
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsQrResultModalVisible(false)}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {qrResultData?.winningInfo && (
              <View style={styles.winningReferenceBar}>
                <Text style={styles.winningReferenceTitle}>
                  제{qrResultData.round}회 공식 당첨번호 {qrResultData.winningInfo.isPending && '(미추첨/확인대기)'}
                </Text>
                <View style={styles.winningRefBallsRow}>
                  {qrResultData.winningInfo.numbers.map((n, idx) => (
                    <View key={`qr-win-${idx}`} style={[styles.refBall, { backgroundColor: qrResultData.winningInfo.isPending ? '#cbd5e1' : getBallColor(n) }]}>
                      <Text style={styles.refBallText}>{qrResultData.winningInfo.isPending ? '?' : n}</Text>
                    </View>
                  ))}
                  <Text style={styles.refPlus}>+</Text>
                  <View style={[styles.refBall, { backgroundColor: qrResultData.winningInfo.isPending ? '#cbd5e1' : getBallColor(qrResultData.winningInfo.bnusNo) }]}>
                    <Text style={styles.refBallText}>{qrResultData.winningInfo.isPending ? '?' : qrResultData.winningInfo.bnusNo}</Text>
                  </View>
                </View>
              </View>
            )}

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {qrResultData?.games.map((game, idx) => {
                const res = qrResultData.results?.[idx] || {
                  rank: '조회 대기',
                  grade: 0,
                  color: '#64748b',
                  bg: '#f1f5f9',
                };
                const winNums = (!qrResultData.winningInfo?.isPending && qrResultData.winningInfo?.numbers) ? qrResultData.winningInfo.numbers : [];
                const bonusNum = !qrResultData.winningInfo?.isPending ? qrResultData.winningInfo?.bnusNo : null;

                return (
                  <View key={`qr-res-${idx}`} style={styles.savedGameItem}>
                    <View style={styles.savedRowTop}>
                      <View style={styles.gameTopLeftGroup}>
                        <View style={styles.miniBadge}>
                          <Text style={styles.miniBadgeText}>{gameLabels[idx] || `${idx + 1}`}</Text>
                        </View>
                        <View style={[styles.resultBadge, { backgroundColor: res.bg }]}>
                          <Text style={[styles.resultBadgeText, { color: res.color }]}>
                            {res.rank}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.savedBallsRow}>
                      {game.map((num) => {
                        const isMatched = winNums.includes(num);
                        const isBonus = num === bonusNum;

                        return (
                          <View
                            key={`qr-b-${idx}-${num}`}
                            style={[
                              styles.miniBall,
                              { backgroundColor: getBallColor(num) },
                              isMatched && styles.matchedBallHighlight,
                              isBonus && styles.bonusBallHighlight,
                            ]}
                          >
                            <Text style={styles.miniBallText}>{num}</Text>
                            {isMatched && <Text style={styles.matchMark}>✓</Text>}
                            {isBonus && <Text style={styles.bonusMark}>B</Text>}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.modalFooterRow}>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={async () => {
                  if (!qrResultData) return;
                  const now = new Date();
                  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
                    now.getDate()
                  ).padStart(2, '0')} (QR ${qrResultData.round}회)`;

                  const newEntry = {
                    id: Date.now().toString(),
                    date: dateStr,
                    games: qrResultData.games,
                  };

                  const updated = [newEntry, ...savedSets];
                  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                  setSavedSets(updated);
                  Alert.alert('보관 완료', '스캔한 번호가 보관함에 저장되었습니다.');
                  setIsQrResultModalVisible(false);
                }}
              >
                <Text style={styles.btnTextWhite}>💾 보관함에 담기</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmBtn, { flex: 1 }]}
                onPress={() => {
                  setIsQrResultModalVisible(false);
                  setScanned(false);
                  handleOpenQrScanner();
                }}
              >
                <Text style={styles.btnTextWhite}>다시 스캔</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -----------------------------------------------------------------
// 스타일시트
// -----------------------------------------------------------------
const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  backgroundImage: {
    width: SCREEN_WIDTH,
    height: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  goldCoinTrigger: {
    position: 'absolute',
    top: '48.5%',
    width: SCREEN_WIDTH * 0.44,
    height: SCREEN_WIDTH * 0.44,
    borderRadius: (SCREEN_WIDTH * 0.44) / 2,
  },
  menuGridContainer: {
    position: 'absolute',
    bottom: '7.5%',
    width: '90%',
    height: '19%',
    justifyContent: 'space-between',
  },
  menuGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: '46%',
  },
  menuGridItem: {
    width: '48%',
    height: '100%',
    borderRadius: 20,
    position: 'relative',
  },
  mainBadgeCounter: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#dc2626',
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  mainBadgeCounterText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  savedModalCounterBadge: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  savedModalCounterBadgeText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '800',
  },
  naverTopIntegratedBtn: {
    backgroundColor: '#03c75a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    elevation: 1,
  },
  naverTopIntegratedBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  bottomModalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'android' ? 36 : 28,
    maxHeight: '94%',
  },

  fullScreenModalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  fullScreenModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  fullScreenScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  headerRefreshBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headerRefreshText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563eb',
  },
  closeBtn: { padding: 6 },
  closeBtnText: { fontSize: 18, color: '#94a3b8', fontWeight: 'bold' },

  analysisNavSubBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  analysisNavBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 7,
  },
  analysisNavBtnDisabled: {
    backgroundColor: '#cbd5e1',
  },
  analysisNavBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  analysisNavBtnTextDisabled: {
    color: '#94a3b8',
  },
  analysisNavCenterInfo: {
    alignItems: 'center',
  },
  analysisNavRoundBadge: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
  },
  analysisDeleteBtn: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  analysisDeleteBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#dc2626',
  },

  manualTopOptionBtn: {
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  manualTopOptionBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
  },
  twoOptionBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    marginTop: 2,
  },
  bottomOptionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  strictOptionBtn: {
    backgroundColor: '#059669',
  },
  normalOptionBtn: {
    backgroundColor: '#2563eb',
  },
  bottomOptionBtnTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  bottomOptionBtnSub: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  modalScroll: { maxHeight: 330, marginBottom: 8 },
  modalFooterRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  confirmBtn: {
    backgroundColor: '#334155',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtn: {
    flex: 1.2,
    backgroundColor: '#d97706',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnTextWhite: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  btnTextWhiteBold: { color: '#ffffff', fontWeight: '900', fontSize: 14 },

  exportButtonGroup: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  exportPdfBtn: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  exportPdfBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  exportExcelBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  exportExcelBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  deleteAllSavedBtn: {
    flex: 1.2,
    backgroundColor: '#475569',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  deleteAllSavedBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  centerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  excludePopupBox: {
    width: POPUP_WIDTH,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 10,
  },
  excludeHeaderBox: {
    backgroundColor: '#d1d5db',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  excludeHeaderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1e293b',
  },
  excludeCloseTouch: {
    position: 'absolute',
    right: 14,
    padding: 4,
  },
  excludeCloseX: {
    fontSize: 20,
    color: '#6b7280',
    fontWeight: 'bold',
  },
  excludeCountBar: {
    backgroundColor: '#bfdbfe',
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  excludeCountText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  excludeCountHighlight: {
    color: '#2563eb',
    fontSize: 13,
  },

  smartFormulaPanel: {
    backgroundColor: '#f8fafc',
    marginHorizontal: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  smartAuto12Btn: {
    backgroundColor: '#b91c1c',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 10,
    elevation: 2,
  },
  smartAuto12BtnTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  smartAuto12BtnSub: {
    color: '#fecaca',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  algoSectionHeaderTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 8,
  },
  algoButtonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  algoGridBtn: {
    width: '48.8%',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  algoGridBtnTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#1e293b',
  },
  algoGridBtnSub: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '700',
  },

  excludeBallWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: BALL_GAP,
  },
  standardLottoBall: {
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    position: 'relative',
  },
  standardLottoBallText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  standardLottoBallExcluded: {
    backgroundColor: '#cbd5e1',
    opacity: 0.35,
    elevation: 0,
  },
  standardLottoBallTextExcluded: {
    color: '#64748b',
    textDecorationLine: 'line-through',
  },
  ballStrikeBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballStrikeX: {
    color: '#dc2626',
    fontSize: 22,
    fontWeight: '900',
  },

  excludePopupBtnRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  excludeConfirmOrangeBtn: {
    flex: 1,
    backgroundColor: '#f97316',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  excludeInvertPurpleBtn: {
    flex: 1.1,
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  excludeResetBlueBtn: {
    flex: 1,
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  manualSelectionBar: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  manualSelectionBarTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  manualMiniBallsPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
  },
  manualPlaceholderText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  manualSelectedMiniBall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSelectedMiniBallText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  manualLottoBallSelected: {
    borderWidth: 3,
    borderColor: '#059669',
    transform: [{ scale: 1.08 }],
  },
  manualSelectedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#059669',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSelectedBadgeCheck: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  oppositeActionBtn: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 6,
  },
  oppositeActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  oppositeBannerBtn: {
    backgroundColor: '#f5f3ff',
    borderWidth: 1.5,
    borderColor: '#ddd6fe',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  oppositeBannerBtnTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6d28d9',
  },
  oppositeBannerBtnSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8b5cf6',
  },
  winningReferenceBar: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  winningRefHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  winningReferenceTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  smallRefreshTouch: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  smallRefreshTouchText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563eb',
  },
  winningRefBallsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 24,
  },
  refBall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refBallText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  refPlus: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginHorizontal: 2,
  },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 15, color: '#64748b', fontWeight: '600' },
  emptySubText: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  savedCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
  },
  savedCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  savedDate: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  delText: { fontSize: 11, color: '#94a3b8', fontWeight: 'bold' },
  savedGameItem: {
    marginVertical: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  savedRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  gameTopLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniBadge: {
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  singleGameDeleteTouch: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  singleGameDeleteText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#dc2626',
  },
  savedBallsRow: {
    flexDirection: 'row',
    gap: 4,
    marginVertical: 4,
  },
  miniBall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  miniBallText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  matchedBallHighlight: {
    borderWidth: 2,
    borderColor: '#dc2626',
  },
  bonusBallHighlight: {
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  matchMark: {
    position: 'absolute',
    top: -2,
    right: -2,
    fontSize: 8,
    color: '#dc2626',
    fontWeight: '900',
  },
  bonusMark: {
    position: 'absolute',
    top: -2,
    right: -2,
    fontSize: 8,
    color: '#2563eb',
    fontWeight: '900',
  },
  historyStatsBox: {
    marginTop: 4,
  },
  historyStatsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  historyTotalText: {
    color: '#dc2626',
    fontWeight: '800',
  },
  historyDetailText: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  badge: {
    backgroundColor: '#1e293b',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  ballsRow: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
  ball: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    position: 'relative',
  },
  ballText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  roundItemCard: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  roundItemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  roundItemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roundNumberBadge: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  roundItemDateText: {
    fontSize: 11,
    color: '#64748b',
  },
  roundItemActionsRow: {
    flexDirection: 'row',
  },
  miniBallsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listMiniBall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listMiniBallText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  miniPlusSign: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginHorizontal: 1,
  },
  analysisSmallBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  analysisSmallBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563eb',
  },
  analysisBallsCard: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  analysisBallsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  analysisBall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisBallText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  analysisPlus: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94a3b8',
  },

  detailMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  detailMetricCard: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailMetricCardFull: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailMetricHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 3,
  },
  detailMetricValue: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1e293b',
  },
  detailMetricSub: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
  },
  hotColdRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  hotBadgeBox: {
    flex: 1,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
  },
  hotBadgeTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b91c1c',
  },
  hotBadgeNum: {
    fontSize: 14,
    fontWeight: '900',
    color: '#dc2626',
    marginVertical: 1,
  },
  hotBadgeSub: {
    fontSize: 9.5,
    color: '#7f1d1d',
    fontWeight: '600',
  },
  coldBadgeBox: {
    flex: 1,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
  },
  coldBadgeTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  coldBadgeNum: {
    fontSize: 14,
    fontWeight: '900',
    color: '#2563eb',
    marginVertical: 1,
  },
  coldBadgeSub: {
    fontSize: 9.5,
    color: '#1e3a8a',
    fontWeight: '600',
  },

  slipCardHeader: {
    marginBottom: 6,
  },
  slipSubDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },

  patternToggleControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f1f5f9',
    padding: 6,
    borderRadius: 8,
    marginBottom: 8,
  },
  patternToggleControlLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginLeft: 2,
  },
  patternToggleBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingVertical: 4,
    alignItems: 'center',
  },
  patternToggleBtn1Active: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },
  patternToggleBtn2Active: {
    backgroundColor: '#e0f2fe',
    borderColor: '#0284c7',
  },
  patternToggleBtn3Active: {
    backgroundColor: '#dcfce7',
    borderColor: '#16a34a',
  },
  patternToggleBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  patternToggleBtnTextActive: {
    fontWeight: '900',
    color: '#0f172a',
  },

  slipGridBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
  },
  slipGridRow: {
    flexDirection: 'row',
    gap: 4,
    marginVertical: 2,
  },
  slipCell: {
    width: (POPUP_WIDTH - 80) / 7,
    height: 26,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  slipCellEmpty: {
    width: (POPUP_WIDTH - 80) / 7,
    height: 26,
    backgroundColor: 'transparent',
  },
  slipCellMarked: {
    backgroundColor: '#1e293b',
    borderColor: '#0f172a',
  },
  slipCellText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  slipCellTextMarked: {
    color: '#ffffff',
    fontWeight: '900',
  },
  slipCheckBar: {
    position: 'absolute',
    width: '80%',
    height: 3,
    backgroundColor: '#ef4444',
    bottom: 2,
    borderRadius: 1,
  },

  overlayDotContainer: {
    position: 'absolute',
    top: 2,
    right: 2,
    flexDirection: 'row',
    gap: 2,
  },
  overlayDotRed: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#dc2626',
  },
  overlayDotBlue: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#0284c7',
  },
  overlayDotGreen: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#16a34a',
  },

  slipStatsPanel: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  slipStatRow: {
    marginVertical: 2,
  },
  slipStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  slipStatValue: {
    fontSize: 10,
    color: '#1e3a8a',
    fontWeight: 'bold',
    marginTop: 1,
  },
  slipBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  slipDeadBadge: {
    flex: 1,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
  slipDeadBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b91c1c',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metricItem: {
    width: '48.5%',
    backgroundColor: '#f1f5f9',
    padding: 8,
    borderRadius: 8,
  },
  metricItemFull: {
    width: '100%',
    backgroundColor: '#f1f5f9',
    padding: 8,
    borderRadius: 8,
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  analysisSectionCard: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  analysisSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 6,
  },
  rankWinsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  rankWinCol: {
    alignItems: 'center',
  },
  rankWinLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  rankWinValBlue: { fontSize: 13, fontWeight: '800', color: '#2563eb' },
  rankWinValGreen: { fontSize: 13, fontWeight: '800', color: '#059669' },
  rankWinValPurple: { fontSize: 13, fontWeight: '800', color: '#7c3aed' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 4,
    marginBottom: 4,
  },
  thText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  microBall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  microBallText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  tdText: {
    fontSize: 11,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  pairRankBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#d97706',
  },
  pairCountText: {
    fontSize: 11,
    color: '#475569',
  },
  scannerWrapper: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  scannerHeaderTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  scannerCloseBtn: {
    padding: 6,
  },
  scannerCloseIcon: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  scannerBody: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTargetBox: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  cornerBracket: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#38bdf8',
  },
  bracketTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  bracketTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  bracketBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  bracketBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  scannerFooter: {
    alignItems: 'center',
    paddingBottom: 30,
    paddingHorizontal: 20,
  },
  scannerGuideText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  scannerSubGuideText: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  scannerBottomBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  scannerBottomBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 6,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  searchBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  roundBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563eb',
  },
  disabledText: {
    color: '#cbd5e1',
  },
  currentRoundText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  winning15Scroll: {
    flex: 1,
    marginVertical: 4,
  },
});
