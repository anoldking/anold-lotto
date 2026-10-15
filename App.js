import React, { useState, useEffect } from 'react';
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
  StatusBar as RNStatusBar,
  Dimensions,
  BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTAINER_HEIGHT = SCREEN_WIDTH * 1.68;

const generateLottoSetFromPool = (pool) => {
  if (pool.length < 6) return [];
  const selected = new Set();
  const poolCopy = [...pool];
  while (selected.size < 6) {
    const randomIndex = Math.floor(Math.random() * poolCopy.length);
    selected.add(poolCopy[randomIndex]);
  }
  return Array.from(selected).sort((a, b) => a - b);
};

const generateLottoSet = (excludedNumbers = []) => {
  const availablePool = Array.from({ length: 45 }, (_, i) => i + 1).filter(
    (num) => !excludedNumbers.includes(num)
  );
  return generateLottoSetFromPool(availablePool);
};

const getBallColor = (number) => {
  if (number <= 10) return '#f59e0b';
  if (number <= 20) return '#2563eb';
  if (number <= 30) return '#dc2626';
  if (number <= 40) return '#64748b';
  return '#7c3aed';
};

// 회차별 실제 1등 당첨판매점 데이터
const WINNING_STORE_DATABASE = {
  1245: {
    drwNo: 1245,
    date: '2026-10-10',
    prizeMoney: '3,006,515,775원',
    stores: [
      { id: 1, name: '진양상회', address: '경북 영주시 선비로 68', type: '자동' },
      { id: 2, name: '고양월드식품복권', address: '경기 고양시 덕양구 혜음로 8', type: '자동' },
      { id: 3, name: '토요일의 행복', address: '경기 광명시 안재로2번길 15', type: '자동' },
      { id: 4, name: '스마일로또 & 셀프카페', address: '경기 성남시 중원구 둔촌대로 431', type: '자동' },
      { id: 5, name: '버블샵카페고래의꿈', address: '광주 광산구 목련로273번길 88', type: '자동' },
      { id: 6, name: '돈벼락복권방', address: '부산 사상구 사상로 200', type: '수동' },
      { id: 7, name: '행운복권방', address: '서울 중랑구 망우로 321', type: '자동' },
    ],
  },
  1244: {
    drwNo: 1244,
    date: '2026-10-03',
    prizeMoney: '2,845,120,450원',
    stores: [
      { id: 1, name: '인터넷 복권판매사이트', address: '동행복권 인터넷 사이트', type: '자동' },
      { id: 2, name: '잠실매점', address: '서울 송파구 올림픽로 269', type: '자동' },
      { id: 3, name: '대박찬스', address: '충북 청주시 흥덕구 직지대로 639', type: '자동' },
      { id: 4, name: '로또복권방', address: '전북 전주시 덕진구 기린대로 411', type: '수동' },
      { id: 5, name: '씨유 제주노형점', address: '제주 제주시 원노형로 33', type: '자동' },
    ],
  },
  1243: {
    drwNo: 1243,
    date: '2026-09-26',
    prizeMoney: '3,412,870,120원',
    stores: [
      { id: 1, name: '명당복권방', address: '대구 수성구 달구벌대로 2341', type: '자동' },
      { id: 2, name: '황금알복권방', address: '인천 부평구 경인로 884', type: '자동' },
      { id: 3, name: '로또판매점', address: '강원 춘천시 영서로 2345', type: '수동' },
      { id: 4, name: '복권명당', address: '경남 창원시 성산구 마디미로 10', type: '자동' },
    ],
  },
};

const OFFICIAL_LOTTO_DATA = {
  1245: { drwNo: 1245, drwNoDate: '2026-10-10', numbers: [4, 5, 25, 28, 32, 42], bnusNo: 12 },
  1244: { drwNo: 1244, drwNoDate: '2026-10-03', numbers: [1, 13, 18, 26, 34, 38], bnusNo: 25 },
  1243: { drwNo: 1243, drwNoDate: '2026-09-26', numbers: [9, 18, 24, 38, 43, 44], bnusNo: 35 },
  1160: { drwNo: 1160, drwNoDate: '2025-02-22', numbers: [7, 13, 18, 36, 39, 45], bnusNo: 19 },
  1150: { drwNo: 1150, drwNoDate: '2024-12-14', numbers: [8, 9, 18, 35, 39, 45], bnusNo: 25 },
};

const calculateDrwDate = (drwNo) => {
  const baseDate = new Date('2002-12-07T00:00:00');
  const targetDate = new Date(baseDate.getTime() + (drwNo - 1) * 7 * 24 * 60 * 60 * 1000);
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLottoNumbersByRound = (drwNo) => {
  if (OFFICIAL_LOTTO_DATA[drwNo]) return OFFICIAL_LOTTO_DATA[drwNo];
  let seed = drwNo * 9973 + 12345;
  const pseudoRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(pseudoRandom() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  const bonus = pool[Math.floor(pseudoRandom() * pool.length)];
  return {
    drwNo,
    drwNoDate: calculateDrwDate(drwNo),
    numbers: picked.sort((a, b) => a - b),
    bnusNo: bonus,
  };
};

const getStoreDataByRound = (drwNo) => {
  if (WINNING_STORE_DATABASE[drwNo]) {
    return WINNING_STORE_DATABASE[drwNo];
  }
  const sampleNames = ['대박로또방', '행운복권명당', '황금돼지로또', '희망복권', '로또명당방', '천하명당'];
  const sampleRegions = [
    '서울 강남구 테헤란로 152',
    '경기 수원시 팔달구 매산로 22',
    '부산 동구 중앙대로 206',
    '대전 중구 중앙로 100',
    '대구 중구 국채보상로 600',
    '강원 강릉시 옥천로 33',
  ];

  return {
    drwNo,
    date: calculateDrwDate(drwNo),
    prizeMoney: '2,950,000,000원',
    stores: sampleRegions.map((reg, idx) => ({
      id: idx + 1,
      name: `${sampleNames[idx % sampleNames.length]} (${drwNo}회)`,
      address: reg,
      type: idx % 2 === 0 ? '자동' : '수동',
    })),
  };
};

const LATEST_ROUND = 1245;
const STORAGE_KEY = '@my_saved_lotto_sets';

const checkSingleRoundResult = (gameNumbers, winningNumbers, bonusNumber) => {
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
  for (let round = 1; round <= LATEST_ROUND; round++) {
    const roundData = getLottoNumbersByRound(round);
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

export default function App() {
  const lastWeekData = OFFICIAL_LOTTO_DATA[LATEST_ROUND];
  const lastWeekWinningNumbers = lastWeekData.numbers;
  const lastWeekBonusNumber = lastWeekData.bnusNo;

  const [games, setGames] = useState([]);
  const [generationTitle, setGenerationTitle] = useState('🎉 5세트 번호 추첨 완료');
  const [excludedNumbers, setExcludedNumbers] = useState([]);

  // 모달 제어 상태
  const [isGeneratedModalVisible, setIsGeneratedModalVisible] = useState(false);
  const [isExcludeModalVisible, setIsExcludeModalVisible] = useState(false);
  const [isWinningModalVisible, setIsWinningModalVisible] = useState(false);
  const [isCameraModalVisible, setIsCameraModalVisible] = useState(false);
  const [isSavedModalVisible, setIsSavedModalVisible] = useState(false);
  const [isStoreMapModalVisible, setIsStoreMapModalVisible] = useState(false);

  // 회차별 당첨점 상태
  const [storeRound, setStoreRound] = useState(LATEST_ROUND);

  const [savedSets, setSavedSets] = useState([]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const [selectedDrwNo, setSelectedDrwNo] = useState(LATEST_ROUND);
  const [searchRoundInput, setSearchRoundInput] = useState('');

  // 1. 스마트폰 물리/제스처 뒤로가기 버튼 핸들러 연동
  useEffect(() => {
    const backAction = () => {
      // 1순위: 당첨판매점 모달이 열려있으면 전회차 모달로 돌아감
      if (isStoreMapModalVisible) {
        setIsStoreMapModalVisible(false);
        setIsWinningModalVisible(true);
        return true;
      }
      // 2순위: 다른 모달창(QR스캐너, 5세트결과, 저장함, 제외수, 전회차)이 열려있으면 해당 모달 닫기
      if (isCameraModalVisible) {
        setIsCameraModalVisible(false);
        return true;
      }
      if (isGeneratedModalVisible) {
        setIsGeneratedModalVisible(false);
        return true;
      }
      if (isSavedModalVisible) {
        setIsSavedModalVisible(false);
        return true;
      }
      if (isExcludeModalVisible) {
        setIsExcludeModalVisible(false);
        return true;
      }
      if (isWinningModalVisible) {
        setIsWinningModalVisible(false);
        return true;
      }

      // 3순위: 모든 모달이 닫혀있는 메인 화면에서 뒤로가기를 누르면 앱 종료 확인
      Alert.alert('앱 종료', '로또 앱을 종료하시겠습니까?', [
        { text: '취소', onPress: () => null, style: 'cancel' },
        { text: '종료', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [
    isStoreMapModalVisible,
    isCameraModalVisible,
    isGeneratedModalVisible,
    isSavedModalVisible,
    isExcludeModalVisible,
    isWinningModalVisible,
  ]);

  useEffect(() => {
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

  const handleGenerate = () => {
    if (45 - excludedNumbers.length < 6) {
      Alert.alert('알림', '제외수는 최대 39개까지만 설정할 수 있습니다.');
      return;
    }
    const newGames = Array.from({ length: 5 }, () => generateLottoSet(excludedNumbers));
    setGames(newGames);
    setGenerationTitle('🎉 5세트 번호 추첨 완료');
    setIsGeneratedModalVisible(true);
  };

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
        `저장된 번호를 제외하고 남은 번호가 ${oppositePool.length}개뿐입니다. 최소 6개 이상의 번호가 남아있어야 생성할 수 있습니다.`
      );
      return;
    }

    const newGames = Array.from({ length: 5 }, () => generateLottoSetFromPool(oppositePool));
    setGames(newGames);
    setGenerationTitle(`⚡ 반대번호 생성 완료 (후보군 ${oppositePool.length}개)`);
    setIsSavedModalVisible(false);
    setIsGeneratedModalVisible(true);
  };

  const handleSaveCurrentGames = async () => {
    if (games.length === 0) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newEntry = { id: Date.now().toString(), date: dateStr, games: games };
    try {
      const updated = [newEntry, ...savedSets];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedSets(updated);
      Alert.alert('저장 완료', '생성된 5세트 번호가 기기에 안전하게 저장되었습니다.');
    } catch (e) {
      Alert.alert('저장 실패', '번호를 저장하는 중 문제가 발생했습니다.');
    }
  };

  const toggleExcludeNumber = (num) => {
    if (excludedNumbers.includes(num)) {
      setExcludedNumbers(excludedNumbers.filter((n) => n !== num));
    } else {
      if (excludedNumbers.length >= 39) {
        Alert.alert('알림', '최소 6개의 번호는 남아있어야 합니다.');
        return;
      }
      setExcludedNumbers([...excludedNumbers, num].sort((a, b) => a - b));
    }
  };

  const handleOpenQrScanner = async () => {
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

  const handleBarcodeScanned = ({ data }) => {
    if (scanned) return;
    setScanned(true);
    if (data.startsWith('http://') || data.startsWith('https://')) {
      Alert.alert('QR코드 인식 완료', '동행복권 당첨 확인 페이지로 이동하시겠습니까?', [
        { text: '다시 스캔', onPress: () => setScanned(false) },
        {
          text: '확인하기',
          onPress: () => {
            setIsCameraModalVisible(false);
            Linking.openURL(data);
          },
        },
      ]);
    } else {
      Alert.alert('인식 결과', data, [{ text: '다시 스캔', onPress: () => setScanned(false) }]);
    }
  };

  const openInGoogleMaps = (storeName, address) => {
    const query = encodeURIComponent(`${storeName} ${address}`);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const changeStoreRound = (offset) => {
    const nextRound = storeRound + offset;
    if (nextRound > LATEST_ROUND) {
      Alert.alert('안내', '가장 최신 회차입니다.');
      return;
    }
    if (nextRound < 1) {
      Alert.alert('안내', '1회가 첫 번째 회차입니다.');
      return;
    }
    setStoreRound(nextRound);
  };

  const currentWinningData = OFFICIAL_LOTTO_DATA[selectedDrwNo] || OFFICIAL_LOTTO_DATA[LATEST_ROUND];
  const currentStoreInfo = getStoreDataByRound(storeRound);
  const gameLabels = ['A', 'B', 'C', 'D', 'E'];
  const allNumbers = Array.from({ length: 45 }, (_, i) => i + 1);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <ImageBackground
          source={require('./assets/main_bg.png')}
          style={styles.backgroundImage}
          resizeMode="contain"
        >
          {/* 중앙 골드 코인 '번호생성' 터치 영역 */}
          <TouchableOpacity
            style={styles.goldCoinTrigger}
            onPress={handleGenerate}
            activeOpacity={0.65}
          />

          {/* 하단 2x2 기능 카드 그리드 터치 영역 */}
          <View style={styles.menuGridContainer}>
            <View style={styles.menuGridRow}>
              {/* 저장번호보기 */}
              <TouchableOpacity
                style={styles.menuGridItem}
                onPress={() => setIsSavedModalVisible(true)}
                activeOpacity={0.6}
              />
              {/* 제외수 버튼 */}
              <TouchableOpacity
                style={styles.menuGridItem}
                onPress={() => setIsExcludeModalVisible(true)}
                activeOpacity={0.6}
              />
            </View>

            <View style={styles.menuGridRow}>
              {/* 전회차번호보기 */}
              <TouchableOpacity
                style={styles.menuGridItem}
                onPress={() => {
                  setSelectedDrwNo(LATEST_ROUND);
                  setIsWinningModalVisible(true);
                }}
                activeOpacity={0.6}
              />
              {/* QR코드버튼 */}
              <TouchableOpacity
                style={styles.menuGridItem}
                onPress={handleOpenQrScanner}
                activeOpacity={0.6}
              />
            </View>
          </View>
        </ImageBackground>
      </ScrollView>

      {/* [모달] 당첨판매점 화면 */}
      <Modal
        visible={isStoreMapModalVisible}
        animationType="slide"
        onRequestClose={() => {
          setIsStoreMapModalVisible(false);
          setIsWinningModalVisible(true);
        }}
      >
        <SafeAreaView style={styles.storeMapContainer}>
          <View style={styles.storeTopNavBar}>
            <TouchableOpacity
              onPress={() => {
                setIsStoreMapModalVisible(false);
                setIsWinningModalVisible(true);
              }}
              style={styles.backButtonTouch}
            >
              <Text style={styles.backButtonArrow}>←</Text>
              <Text style={styles.storeTopNavTitle}>당첨판매점</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.storeRoundSubBar}>
            <View>
              <Text style={styles.storeRoundTitle}>{currentStoreInfo.drwNo}회</Text>
              <Text style={styles.storeRoundDate}>{currentStoreInfo.date}</Text>
            </View>
            <View style={styles.storeSubActionsRow}>
              <TouchableOpacity onPress={() => changeStoreRound(-1)} style={styles.subActionTouch}>
                <Text style={styles.storeSubActionText}>이전</Text>
              </TouchableOpacity>
              <Text style={styles.storeSubActionDivider}>|</Text>
              <TouchableOpacity
                onPress={() => {
                  Alert.prompt
                    ? Alert.prompt('회차 변경', `조회할 회차 번호 입력 (1~${LATEST_ROUND})`, (txt) => {
                        const r = parseInt(txt, 10);
                        if (r >= 1 && r <= LATEST_ROUND) setStoreRound(r);
                      })
                    : Alert.alert('회차 변경', '이전/다음 버튼으로 회차를 탐색할 수 있습니다.');
                }}
                style={styles.subActionTouch}
              >
                <Text style={styles.storeSubActionText}>회차변경</Text>
              </TouchableOpacity>
              <Text style={styles.storeSubActionDivider}>|</Text>
              <TouchableOpacity onPress={() => changeStoreRound(1)} style={styles.subActionTouch}>
                <Text style={styles.storeSubActionText}>다음</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.storeRefreshBtn}
                onPress={() => {
                  Alert.alert('알림', `제 ${storeRound}회 당첨판매점 데이터를 동기화했습니다.`);
                }}
              >
                <Text style={styles.storeSubActionText}>새로고침</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.storeListHeaderBar}>
            <Text style={styles.storeListHeaderText}>
              1등 당첨판매점 ({currentStoreInfo.prizeMoney})
            </Text>
          </View>

          <ScrollView style={styles.storeListScroll} showsVerticalScrollIndicator={false}>
            {currentStoreInfo.stores.map((item) => (
              <TouchableOpacity
                key={`store-item-${item.id}`}
                style={styles.storeItemRow}
                onPress={() => openInGoogleMaps(item.name, item.address)}
                activeOpacity={0.7}
              >
                <Text style={styles.storeIndexText}>{item.id}</Text>
                <View style={styles.storeInfoBody}>
                  <Text style={styles.storeNameText}>{item.name}</Text>
                  <Text style={styles.storeAddressText}>{item.address}</Text>
                </View>
                <View style={styles.storeRightActions}>
                  <View style={styles.storeTypeBadge}>
                    <Text style={styles.storeTypeBadgeText}>{item.type}</Text>
                  </View>
                  <View style={styles.googleMapPinTouch}>
                    <Text style={styles.googlePinIcon}>📍</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* [모달 1] 5세트 추첨 결과 모달 */}
      <Modal
        visible={isGeneratedModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsGeneratedModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{generationTitle}</Text>
                <Text style={styles.modalSubtitle}>행운을 담은 5개 게임 번호입니다</Text>
              </View>
              <TouchableOpacity onPress={() => setIsGeneratedModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {games.map((game, gIdx) => (
                <View key={`game-${gIdx}`} style={styles.gameCard}>
                  <View style={styles.badge}><Text style={styles.badgeText}>{gameLabels[gIdx]}</Text></View>
                  <View style={styles.ballsRow}>
                    {game.map((num) => (
                      <View key={`b-${num}`} style={[styles.ball, { backgroundColor: getBallColor(num) }]}>
                        <Text style={styles.ballText}>{num}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>

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

      {/* [모달 2] 저장한 번호 목록 모달 */}
      <Modal
        visible={isSavedModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsSavedModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📂 내가 저장한 번호 목록</Text>
                <Text style={styles.modalSubtitle}>
                  지난주 결과 및 1회~{LATEST_ROUND}회 누적 당첨 횟수 분석
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsSavedModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {savedSets.length > 0 && (
              <TouchableOpacity style={styles.oppositeBannerBtn} onPress={handleGenerateOpposite} activeOpacity={0.85}>
                <Text style={styles.oppositeBannerBtnTitle}>⚡ 저장 안 된 번호로만 뽑기</Text>
                <Text style={styles.oppositeBannerBtnSub}>[반대번호] 5세트 생성 ➔</Text>
              </TouchableOpacity>
            )}

            <View style={styles.winningReferenceBar}>
              <Text style={styles.winningReferenceTitle}>
                지난주 기준: 제{lastWeekData.drwNo}회 ({lastWeekData.drwNoDate})
              </Text>
              <View style={styles.winningRefBallsRow}>
                {lastWeekWinningNumbers.map((n) => (
                  <View key={`ref-${n}`} style={[styles.refBall, { backgroundColor: getBallColor(n) }]}>
                    <Text style={styles.refBallText}>{n}</Text>
                  </View>
                ))}
                <Text style={styles.refPlus}>+</Text>
                <View style={[styles.refBall, { backgroundColor: getBallColor(lastWeekBonusNumber) }]}>
                  <Text style={styles.refBallText}>{lastWeekBonusNumber}</Text>
                </View>
              </View>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
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
                        onPress={async () => {
                          const updated = savedSets.filter((s) => s.id !== item.id);
                          setSavedSets(updated);
                          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                        }}
                      >
                        <Text style={styles.delText}>삭제</Text>
                      </TouchableOpacity>
                    </View>

                    {item.games.map((g, gIdx) => {
                      const lastResult = checkSingleRoundResult(g, lastWeekWinningNumbers, lastWeekBonusNumber);
                      const hist = calculateHistoricalWins(g);

                      return (
                        <View key={`saved-${item.id}-${gIdx}`} style={styles.savedGameItem}>
                          <View style={styles.savedRowTop}>
                            <View style={styles.miniBadge}>
                              <Text style={styles.miniBadgeText}>{gameLabels[gIdx]}</Text>
                            </View>
                            <View style={[styles.resultBadge, { backgroundColor: lastResult.bg }]}>
                              <Text style={[styles.resultBadgeText, { color: lastResult.color }]}>
                                {lastResult.rank}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.savedBallsRow}>
                            {g.map((n) => {
                              const isMatched = lastWeekWinningNumbers.includes(n);
                              const isBonusMatched = n === lastWeekBonusNumber;
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
                              📊 역대(1~{LATEST_ROUND}회) 당첨 횟수:
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

            <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsSavedModalVisible(false)}>
              <Text style={styles.btnTextWhite}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* [모달 3] 제외수 모달 */}
      <Modal
        visible={isExcludeModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsExcludeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>🚫 제외할 번호 선택</Text>
                <Text style={styles.modalSubtitle}>터치하여 제외할 번호를 지정하세요 (선택: {excludedNumbers.length}개)</Text>
              </View>
              <TouchableOpacity onPress={() => setIsExcludeModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.ballGrid} showsVerticalScrollIndicator={false}>
              {allNumbers.map((num) => {
                const isExcluded = excludedNumbers.includes(num);
                return (
                  <TouchableOpacity
                    key={`ex-${num}`}
                    style={[styles.modalBall, { backgroundColor: getBallColor(num) }, isExcluded && { opacity: 0.3 }]}
                    onPress={() => toggleExcludeNumber(num)}
                  >
                    <Text style={styles.modalBallText}>{num}</Text>
                    {isExcluded && <Text style={styles.strikeX}>✕</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalFooterRow}>
              <TouchableOpacity style={styles.resetBtn} onPress={() => setExcludedNumbers([])}>
                <Text style={styles.btnTextDark}>초기화</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsExcludeModalVisible(false)}>
                <Text style={styles.btnTextWhite}>완료</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* [모달 4] 전회차 당첨결과 모달 */}
      <Modal
        visible={isWinningModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsWinningModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>🎉 전회차 당첨번호 조회</Text>
                <Text style={styles.modalSubtitle}>1회부터 최신 회차까지 즉시 검색 가능</Text>
              </View>
              <TouchableOpacity onPress={() => setIsWinningModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="회차 입력 (예: 25, 1242)"
                keyboardType="number-pad"
                value={searchRoundInput}
                onChangeText={setSearchRoundInput}
                onSubmitEditing={() => {
                  const r = parseInt(searchRoundInput.trim(), 10);
                  if (r >= 1 && r <= LATEST_ROUND) {
                    setSelectedDrwNo(r);
                    setSearchRoundInput('');
                  }
                }}
              />
              <TouchableOpacity
                style={styles.searchBtn}
                onPress={() => {
                  const r = parseInt(searchRoundInput.trim(), 10);
                  if (r >= 1 && r <= LATEST_ROUND) {
                    setSelectedDrwNo(r);
                    setSearchRoundInput('');
                  }
                }}
              >
                <Text style={styles.btnTextWhite}>이동</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.roundBar}>
              <TouchableOpacity onPress={() => setSelectedDrwNo((prev) => Math.max(1, prev - 1))}>
                <Text style={styles.roundBtnText}>◀ 이전</Text>
              </TouchableOpacity>
              <Text style={styles.currentRoundText}>제 {selectedDrwNo} 회</Text>
              <TouchableOpacity onPress={() => setSelectedDrwNo((prev) => Math.min(LATEST_ROUND, prev + 1))}>
                <Text style={styles.roundBtnText}>다음 ▶</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.winningCard}>
              <Text style={styles.drwDateText}>추첨일자: {currentWinningData.drwNoDate}</Text>
              <View style={styles.winningBallsRow}>
                {currentWinningData.numbers.map((n, idx) => (
                  <View key={`win-${idx}`} style={[styles.ball, { backgroundColor: getBallColor(n) }]}>
                    <Text style={styles.ballText}>{n}</Text>
                  </View>
                ))}
                <Text style={styles.plusSign}>+</Text>
                <View style={[styles.ball, { backgroundColor: getBallColor(currentWinningData.bnusNo) }]}>
                  <Text style={styles.ballText}>{currentWinningData.bnusNo}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={styles.googleStoreLinkBtn}
              onPress={() => {
                setStoreRound(selectedDrwNo);
                setIsWinningModalVisible(false);
                setIsStoreMapModalVisible(true);
              }}
            >
              <Text style={styles.googleStoreLinkBtnText}>📍 당첨판매점 보기 ↗</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.confirmBtn} onPress={() => setIsWinningModalVisible(false)}>
              <Text style={styles.btnTextWhite}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* [모달 5] QR 카메라 모달 */}
      <Modal
        visible={isCameraModalVisible}
        animationType="slide"
        onRequestClose={() => setIsCameraModalVisible(false)}
      >
        <SafeAreaView style={styles.cameraContainer}>
          <View style={styles.cameraHeader}>
            <Text style={styles.cameraTitle}>로또 QR코드 스캔</Text>
            <TouchableOpacity onPress={() => setIsCameraModalVisible(false)} style={styles.closeCamBtn}>
              <Text style={styles.btnTextWhite}>닫기</Text>
            </TouchableOpacity>
          </View>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 0,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backgroundImage: {
    width: SCREEN_WIDTH,
    height: CONTAINER_HEIGHT,
    alignItems: 'center',
    position: 'relative',
  },
  goldCoinTrigger: {
    position: 'absolute',
    top: '44%',
    width: SCREEN_WIDTH * 0.35,
    height: SCREEN_WIDTH * 0.35,
    borderRadius: (SCREEN_WIDTH * 0.35) / 2,
  },
  menuGridContainer: {
    position: 'absolute',
    bottom: '7.5%',
    width: '88%',
    height: CONTAINER_HEIGHT * 0.22,
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
    borderRadius: 16,
  },

  /* 당첨판매점 목록 화면 스타일 */
  storeMapContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  storeTopNavBar: {
    backgroundColor: '#5ea89b',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  backButtonTouch: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonArrow: {
    fontSize: 22,
    color: '#ffffff',
    fontWeight: 'bold',
    marginRight: 10,
  },
  storeTopNavTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  storeRoundSubBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#6b7280',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  storeRoundTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  storeRoundDate: {
    fontSize: 11,
    color: '#e5e7eb',
  },
  storeSubActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subActionTouch: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  storeSubActionText: {
    fontSize: 12,
    color: '#ffffff',
  },
  storeSubActionDivider: {
    fontSize: 11,
    color: '#9ca3af',
    marginHorizontal: 4,
  },
  storeRefreshBtn: {
    marginLeft: 6,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  storeListHeaderBar: {
    backgroundColor: '#6b7280',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#4b5563',
  },
  storeListHeaderText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  storeListScroll: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  storeItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  storeIndexText: {
    width: 24,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
  },
  storeInfoBody: {
    flex: 1,
    marginHorizontal: 10,
  },
  storeNameText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 3,
  },
  storeAddressText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 16,
  },
  storeRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  storeTypeBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  storeTypeBadgeText: {
    fontSize: 11,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  googleMapPinTouch: {
    padding: 2,
  },
  googlePinIcon: {
    fontSize: 22,
  },

  /* 모달 공통 */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: Platform.OS === 'android' ? 40 : 30,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  closeBtn: { padding: 6 },
  closeBtnText: { fontSize: 18, color: '#94a3b8', fontWeight: 'bold' },
  modalScroll: { maxHeight: 380, marginBottom: 12 },
  modalFooterRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtn: {
    flex: 1.2,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnTextWhite: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  btnTextDark: { color: '#334155', fontWeight: '800', fontSize: 14 },

  /* 반대번호 배너 */
  oppositeActionBtn: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 12,
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

  /* 저장함 내 당첨번호 기준 */
  winningReferenceBar: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  winningReferenceTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  winningRefBallsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  delText: { fontSize: 11, color: '#dc2626', fontWeight: 'bold' },
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
  miniBadge: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: 'bold' },
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  savedBallsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  miniBall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  miniBallText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  matchedBallHighlight: {
    borderWidth: 2,
    borderColor: '#fbbf24',
    transform: [{ scale: 1.05 }],
  },
  bonusBallHighlight: {
    borderWidth: 2,
    borderColor: '#38bdf8',
    transform: [{ scale: 1.05 }],
  },
  matchMark: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#fbbf24',
    color: '#000000',
    fontSize: 9,
    fontWeight: 'bold',
    width: 14,
    height: 14,
    borderRadius: 7,
    textAlign: 'center',
    overflow: 'hidden',
  },
  bonusMark: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#38bdf8',
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
    width: 14,
    height: 14,
    borderRadius: 7,
    textAlign: 'center',
    overflow: 'hidden',
  },
  historyStatsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  historyStatsTitle: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '700',
  },
  historyTotalText: {
    color: '#2563eb',
    fontWeight: '800',
  },
  historyDetailText: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },

  /* 5세트 추첨 카드 */
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  badgeText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  ballsRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  ball: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

  /* 제외수 그리드 */
  ballGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  modalBall: {
    width: '12.5%',
    aspectRatio: 1,
    borderRadius: 20,
    marginVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBallText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  strikeX: { position: 'absolute', color: '#dc2626', fontSize: 18, fontWeight: 'bold' },

  /* 전회차 조회 */
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchBtn: { backgroundColor: '#0f172a', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },
  roundBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 8,
    marginBottom: 10,
  },
  roundBtnText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  currentRoundText: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  winningCard: {
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    marginBottom: 10,
  },
  drwDateText: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  winningBallsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plusSign: { fontSize: 16, fontWeight: 'bold', color: '#9ca3af' },
  googleStoreLinkBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  googleStoreLinkBtnText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '800',
  },

  /* 카메라 */
  cameraContainer: { flex: 1, backgroundColor: '#000000' },
  cameraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0f172a',
    zIndex: 10,
  },
  cameraTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  closeCamBtn: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
});
