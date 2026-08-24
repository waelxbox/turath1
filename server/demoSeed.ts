/**
 * Demo Project Seeder
 * Creates a fully-populated demo project with 4 pages from Al Lataif Al Musawara (1923)
 * including reviewed transcriptions, embeddings, and entities.
 */
import {
  createProject,
  createDocument,
  createTranscription,
  updateDocumentStatus,
  updateReviewedJson,
} from "./db";
import { embedTranscription } from "./embeddingService";
import { extractAndStoreEntities } from "./nerService";

// CDN URLs for the 4 demo document images
const DEMO_IMAGES = [
  {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310419663026825525/HpdAiz2JmYPv8mLm449sXa/demo-doc-1_057f1ca3.jpg",
    filename: "al-lataif-1923-01-22-p13.jpg",
  },
  {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310419663026825525/HpdAiz2JmYPv8mLm449sXa/demo-doc-2_cd1e758d.jpg",
    filename: "al-lataif-1923-01-22-p9.jpg",
  },
  {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310419663026825525/HpdAiz2JmYPv8mLm449sXa/demo-doc-3_c01dabc4.jpg",
    filename: "al-lataif-1923-01-29-p1.jpg",
  },
  {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310419663026825525/HpdAiz2JmYPv8mLm449sXa/demo-doc-4_9130ac8e.jpg",
    filename: "al-lataif-1923-01-29-p16.jpg",
  },
];

// Reviewed transcription data for each document
const DEMO_TRANSCRIPTIONS = [
  {
    // Document 1: Tourism in Upper Egypt
    rawJson: {
      page_number: "13",
      date: "22 January 1923",
      publication: "Al-Lataif Al-Musawara",
      headline: "شبان مصر يهتمون بآثار اجدادهم",
      headline_english: "The Youth of Egypt Care for the Antiquities of Their Ancestors",
      body_text: "على هذه الصفحة طائفة من الصور التي اهدانا اياها بعض الادباء من طلبة الجامعة الاميركية لمناظر رحلتهم في الصعيد للفرجة على الآثار المصرية والسياحة",
      secondary_article: "القاطرة الكهربائية - اختراع ماكونين: القاطرة الكهربائية التي اخترعتها تولد هي نفسها القوة الكهربائية اللازمة بواسطة استعمال النفط في جهاز خاص مركب فيها. يستطيع ان يولد قوة تعادل ٢٠٠٠ او ٣٠٠٠ حصان فهي تجر او تقطر أثقل القطارات.",
      image_captions: [
        "بعض اعضاء الرحلة في اسوان مع اساتذتهم وقد امتطوا الحمير والجمال",
        "الطلبة في الاقصر يتفرجون على مدخل مدفن توتنج آمون ولم يسمح لهم بالتفرج على داخله",
        "اعضاء الرحلة يطلون من نوافذ القطار في محطة المنيا",
        "شبيبة مصر في هيكل آمون في الاقصر",
        "الطيار الفرنسوي بشار ينزل بطيارته امام القصر الكبير في باريس",
        "طلبة الجامعة الاميركية مع اساتذتهم يتفرجون على آثار اجدادهم في الاقصر"
      ],
      people_mentioned: ["ماكونين (Makhonin)", "الطيار بشار (Aviator Bachar)"],
      locations_mentioned: ["اسوان (Aswan)", "الاقصر (Luxor)", "محطة المنيا (Minya Station)", "هيكل آمون (Temple of Amun)", "باريس (Paris)", "القصر الكبير (Grand Palais)", "برلين (Berlin)", "فرنسا (France)", "روسيا (Russia)"],
      topics: ["Tourism", "Archaeology", "Tutankhamun", "Electric Locomotive", "Aviation"],
    },
  },
  {
    // Document 2: Tutankhamun's Tomb
    rawJson: {
      page_number: "9",
      date: "22 January 1923",
      publication: "Al-Lataif Al-Musawara",
      headline: "بعض الاشياء التي لاتقدر بمال ووجدت في مدفن توتنج آمون",
      headline_english: "Some Invaluable Items Found in Tutankhamun's Tomb",
      body_text: "نقلا عن رسومات ومعلومات من اللورد كارنارفون. مناظر النقوش والرسوم الملونة المزخرفة التي تمثل تاريخ الملك توتنج آمون منقولة بالفوتوغراف من مدفن القائد هوي الذي كان تحت قيادته ووجدت في مدافن طيبه.",
      secondary_article: "توتنج ينتقم: هل قامت روح توتنج آمون بعد ٣٠٠٠ سنة تنتقم لنفسها من عبث الايدي بحرمة مدافنها؟ كان المستر كارتر عصفور كنار يغرد في قفصه المعلق في شرفة داره في الاقصر وفي يوم اكتشاف المدفن ودخولهم اليه انسلت افعى الى الدار ووصلت الى العصفور فقتلته.",
      image_captions: [
        "صورة كأس من المرمر وشعدان وصندوق ومركبة ذات عجلتين وجدت في الغرفة الاولى للمدفن",
        "صورة تمثال من الابنوس والذهب وكرسي مستطيل قوائمه كالحيوان",
        "مناظر النقوش والرسوم الملونة المزخرفة التي تمثل تاريخ الملك توتنج آمون",
        "تمثل هذه الصورة كيفية اخراج ونقل الآثار",
        "منظر سكان الاقصر من الفلاحين والامة يصفون في مأتم الشيخ المتوفي",
        "صلاة الناس امام جثة فقيدهم الشيخ"
      ],
      advertisements: ["سيرة الغازي مصطفى باشا كمال - مزينة بصوره الكثيرة", "مجلة الاولاد - ابنة اللطائف المصورة"],
      people_mentioned: ["اللورد كارنارفون (Lord Carnarvon)", "المستر كارتر (Howard Carter)", "توتنج آمون (Tutankhamun)", "القائد هوي (Commander Huy)", "مصطفى باشا كمال (Mustafa Kemal Pasha)"],
      locations_mentioned: ["الاقصر (Luxor)", "مدافن طيبه (Thebes)", "بلاد الحبشة (Abyssinia)"],
      topics: ["Archaeology", "Tutankhamun", "Curse of the Pharaohs", "Excavation", "Ancient Egypt"],
    },
  },
  {
    // Document 3: Front Page - Crime in Alexandria
    rawJson: {
      page_number: "1",
      date: "29 January 1923",
      publication: "Al-Lataif Al-Musawara",
      issue_number: "416",
      volume: "IX",
      headline: "جناية فظيعة في الاسكندرية - مقتل وجيه سوري في داره",
      headline_english: "A Horrific Crime in Alexandria - The Murder of a Syrian Notable in His Home",
      body_text: "فقد حبل الامن فقداً تاماً في الشهور الاخيرة في الاسكندرية ولا سيما في جهات الرمل وتعددت الحوادث والسرقات والجنايات حتى بات أمر ورود اخبارها يوماً فيوماً في الجرائد أمراً معتاداً. ولقد كان أفظع هذه الحوادث الجناية الفظيعة التي نحن بصددها وهي مقتل السري الوجيه المرحوم توفيق بك كرم في عقر داره بينما هو نائم بعد سهرة حافلة أقامها لاصدقائه وذويه بمناسبة رأس السنة.",
      crime_details: "الجناة دخلوا المنزل في الليل من بابه البحري بعد ما نشروا قطعة صغيرة من خشب الباب. صعدوا الى الدور الاول فقطعوا أسلاك التليفون وأسلاك الجرس. في الساعة الثالثة صباحا وجدت المرحوم توفيق بك مقتولا وفي رأسه آثار ضربات من قضيب من حديد.",
      image_captions: [
        "المرحوم توفيق بك كرم من سراة الاسكندرية",
        "منزل المرحوم توفيق بك كرم في محطة كارلتون في الاسكندرية حيث وقعت الجناية والمنزل يعد من أجمل قصور الثغر"
      ],
      people_mentioned: ["توفيق بك كرم (Tawfiq Bey Karam)", "اسكندر مكاريوس (Iskandar Makarius)"],
      locations_mentioned: ["الاسكندرية (Alexandria)", "جهات الرمل (Ramleh)", "محطة كارلتون (Carlton Station)", "القاهرة (Cairo)"],
      topics: ["Crime", "Murder", "Alexandria", "Syrian Community", "Security"],
    },
  },
  {
    // Document 4: Mummy's Warning and Social News
    rawJson: {
      page_number: "16",
      date: "29 January 1923",
      publication: "Al-Lataif Al-Musawara",
      headline: "اللورد كارنارفون يعود الى الاقصر",
      headline_english: "Lord Carnarvon Returns to Luxor",
      body_text: "عاد من لندن جناب اللورد كارنارفون المثري الانجليزي الذي صار الان بفضل اكتشاف رجاله لمدفن توتنج امون من مشاهير الرجال. عاد جنابه من انجلترا على جناح النعامة وقد وصل الى الاقصر قبل وصول هذا العدد الى ايدي قرائه واخذ يهتم مع جماعته بالاستعداد لفتح الحجرة الداخلية للمدفن.",
      cartoon_text: "فهم شعبك الذي يدعى المدنية ان مصر كانت ولا تزال عريقة في المجد منيعة الجانب تحميها الالهة وتثأر لها من العتاة المستبدين فاغسلوا الاهانه التي الحقتموها بها واعيدوا اليها زعيمها الاكبر والا استنزل روحي عليكم السخط والنقمة الى الابد",
      cartoon_description: "Political cartoon: Lord Carnarvon fleeing in terror from a resurrected mummy of Tutankhamun. The mummy speaks about Egyptian national pride and demands the return of antiquities.",
      continuation_from_p1: "ودوائر الاعمال المالية والتجارية على آل كرم يشاطرونهم الحزن في مصابهم الأليم. شيعت جنازة الفقيد بعد ظهر الثلاثاء في مشهد كبير سار فيها العظماء والتجار والاعيان.",
      image_captions: [
        "رسم كاريكاتوري: اللورد كارنارفون يفر من مومياء توتنج آمون",
        "العم رشوان ابرهيم عمره ١١٧ سنة كان فراشا في قطار الخديوي عباس باشا الاول",
        "فريد بك فخري الدين مؤسس ومدير بنك الكونتو الشرقي"
      ],
      people_mentioned: ["اللورد كارنارفون (Lord Carnarvon)", "توتنج آمون (Tutankhamun)", "العم رشوان ابرهيم (Uncle Rashwan Ibrahim)", "فريد بك فخري الدين (Farid Bey Fakhry El-Din)", "الخديوي عباس باشا الاول (Khedive Abbas Pasha I)"],
      locations_mentioned: ["الاقصر (Luxor)", "لندن (London)", "انجلترا (England)", "الاسكندرية (Alexandria)"],
      topics: ["Archaeology", "Tutankhamun", "Nationalism", "Egyptian Antiquities", "Social News", "Banking"],
    },
  },
];

// Demo project configuration (as if generated by onboarding agent)
const DEMO_PROJECT_CONFIG = {
  name: "Al Lataif Al Musawara (1923) — Demo",
  description: "A pre-loaded demo archive of Al-Lataif Al-Musawara (اللطائف المصورة), a weekly Egyptian illustrated magazine from January 1923. Explore 4 fully transcribed pages covering Tutankhamun's tomb discovery, Egyptian nationalism, crime reporting, and early 20th century social life.",
  status: "active" as const,
  modelName: "gemini-2.5-flash",
  pipelineType: "single_pass" as const,
  temperature: 0.1,
  maxTokens: 4096,
  systemPrompt: `You are an expert archival transcription assistant specializing in early 20th century Arabic periodicals. You are transcribing pages from Al-Lataif Al-Musawara (اللطائف المصورة), a weekly illustrated magazine published in Cairo, Egypt.

For each page, extract:
- Page number, date, and publication name
- Main headline (Arabic) and English translation
- Full body text of articles
- Image captions (list all)
- People mentioned (with transliteration)
- Locations mentioned (with transliteration)
- Topics/themes covered

Preserve the original Arabic text exactly as written. Provide transliterations in parentheses for proper nouns. Note any advertisements or secondary articles separately.`,
  jsonSchema: {
    page_number: { type: "string", description: "Page number as printed", nullable: false, displayHint: "short_text" },
    date: { type: "string", description: "Publication date", nullable: false, displayHint: "short_text" },
    publication: { type: "string", description: "Magazine name", nullable: false, displayHint: "short_text" },
    headline: { type: "string", description: "Main headline in Arabic", nullable: false, displayHint: "short_text" },
    headline_english: { type: "string", description: "Main headline translated to English", nullable: false, displayHint: "short_text" },
    body_text: { type: "string", description: "Main article body text in Arabic", nullable: false, displayHint: "long_text" },
    image_captions: { type: "array", description: "List of all image captions on the page", nullable: true, displayHint: "tag_list" },
    people_mentioned: { type: "array", description: "People named in the text with transliteration", nullable: true, displayHint: "tag_list" },
    locations_mentioned: { type: "array", description: "Locations named in the text with transliteration", nullable: true, displayHint: "tag_list" },
    topics: { type: "array", description: "Main topics/themes covered", nullable: true, displayHint: "tag_list" },
  },
  glossary: {
    "اللطائف المصورة": "Al-Lataif Al-Musawara — weekly illustrated magazine, Cairo",
    "توتنج آمون": "Tutankhamun — Egyptian pharaoh, 18th dynasty",
    "اللورد كارنارفون": "Lord Carnarvon — George Herbert, 5th Earl of Carnarvon, archaeologist patron",
    "المستر كارتر": "Howard Carter — British archaeologist who discovered Tutankhamun's tomb",
    "الجامعة الاميركية": "American University in Cairo (AUC)",
    "اسكندر مكاريوس": "Iskandar Makarius — publisher and owner of Al-Lataif Al-Musawara",
    "بك": "Bey — Ottoman/Egyptian honorific title",
    "باشا": "Pasha — high-ranking Ottoman/Egyptian title",
    "الصعيد": "Upper Egypt (Sa'id)",
    "الثغر": "The Port — common epithet for Alexandria",
  },
  postProcessing: [],
  outputFormats: ["json", "csv"],
};

/**
 * Seeds a demo project for the given user.
 * Creates project, documents, transcriptions, embeddings, and entities.
 */
export async function seedDemoProject(userId: number): Promise<{ projectId: number }> {
  // 1. Create the project
  const project = await createProject({
    userId,
    name: DEMO_PROJECT_CONFIG.name,
    description: DEMO_PROJECT_CONFIG.description,
    status: DEMO_PROJECT_CONFIG.status,
    modelName: DEMO_PROJECT_CONFIG.modelName,
    pipelineType: DEMO_PROJECT_CONFIG.pipelineType,
    temperature: DEMO_PROJECT_CONFIG.temperature,
    maxTokens: DEMO_PROJECT_CONFIG.maxTokens,
    systemPrompt: DEMO_PROJECT_CONFIG.systemPrompt,
    jsonSchema: DEMO_PROJECT_CONFIG.jsonSchema,
    glossary: DEMO_PROJECT_CONFIG.glossary,
    postProcessing: DEMO_PROJECT_CONFIG.postProcessing,
    outputFormats: DEMO_PROJECT_CONFIG.outputFormats,
    onboardingReasoning: "Demo project — pre-configured for early 20th century Arabic periodical transcription.",
  });

  const projectId = project.id;

  // 2. Create documents and transcriptions
  for (let i = 0; i < DEMO_IMAGES.length; i++) {
    const img = DEMO_IMAGES[i];
    const transcriptionData = DEMO_TRANSCRIPTIONS[i];

    // Create document record (using CDN URL as both storage path and URL)
    const doc = await createDocument({
      projectId,
      filename: img.filename,
      storagePath: `demo/${img.filename}`,
      storageUrl: img.url,
      mimeType: "image/jpeg",
      fileSizeBytes: 300000,
      status: "reviewed",
    });

    // Create transcription with reviewed data
    const transcription = await createTranscription({
      documentId: doc.id,
      projectId,
      modelUsed: "gemini-2.5-flash (demo)",
      rawJson: transcriptionData.rawJson,
      reviewedJson: transcriptionData.rawJson,
      originalText: transcriptionData.rawJson.body_text,
      confidenceNotes: "Demo data — pre-reviewed",
    });

    // Mark as reviewed
    await updateReviewedJson(transcription.id, doc.id, projectId, transcriptionData.rawJson);
    await updateDocumentStatus(doc.id, projectId, "reviewed");

    // Generate embedding for semantic search (fire and forget)
    embedTranscription({
      projectId,
      documentId: doc.id,
      transcriptionId: transcription.id,
      reviewedJson: transcriptionData.rawJson as Record<string, unknown>,
      filename: img.filename,
    }).catch((err) => console.warn(`[Demo Seed] Embedding failed for doc ${i + 1}:`, err));

    // Extract entities (fire and forget)
    const textForNER = [
      transcriptionData.rawJson.body_text,
      transcriptionData.rawJson.headline,
      ...(transcriptionData.rawJson.people_mentioned || []),
      ...(transcriptionData.rawJson.locations_mentioned || []),
    ].filter(Boolean).join("\n");

    if (textForNER.length > 10) {
      extractAndStoreEntities(projectId, doc.id, textForNER)
        .catch((err) => console.warn(`[Demo Seed] NER failed for doc ${i + 1}:`, err));
    }
  }

  return { projectId };
}
