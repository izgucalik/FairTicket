FairTicket — Proje Kapsamı ve İlerleme Notu

Solana Hackathon Çalışma Notları | Akışlar, İhtiyaç Listesi ve MVP Kapsamı

Mentörümüzün yönlendirmesi doğrultusunda; projenin temel çalışma mantığını, kullanıcı ve sistem akışlarını, ihtiyaç duyacağımız bileşenleri ve demo için sınırlandırdığımız MVP kapsamını bu notta toparladık. Ekip arkadaşlarımızın teknik seviyesini gözeterek aşırı karmaşık terimler yerine somut adımlara odaklandık.

1. Projenin Çözdüğü Temel Sorun ve Çözüm Mantığı

Etkinlik biletlerinde yaşanan başlıca üç probleme odaklanıyoruz:

Karaborsa ve Fahiş Fiyat: İkincil satışta bilet fiyatına maksimum %20 tavan fiyat kuralı koyuyoruz. Akıllı sözleşme belirlenen tavanın üzerindeki satış emirlerini reddeder.

Telif / Pay Dağıtımı: Bilet ikinci el pazarında el değiştirdiğinde satış tutarının %5'i otomatik olarak kulüp veya etkinlik organizatörünün hesabına aktarılır.

Sahte Bilet ve Kopyalama: Ekran görüntüsüyle turnikeden geçişi engellemek için bilet ekranında kısa süreli yenilenen dinamik QR kullanılır. Kapıda ilk okutulduğu an bilet 'kullanıldı' olarak işaretlenir ve tekrar giriş denemeleri sistem tarafından durdurulur.

2. Kullanıcı Deneyimi Akışı (Front-End / Ekranlar)

Kullanıcının ve kapıdaki görevlinin web arayüzünde karşılaşacağı adım adım akış şu şekildedir:

A. Birincil Satış (Etkinlikten Bilet Alma)

Giriş ve Cüzdan: Kullanıcı web sitesine girer ve Phantom cüzdanı ile oturum açar.

Bilet Seçimi: Etkinlik detay sayfasından bilet adedini seçer.

Satın Alma: Devnet üzerindeki test token'ı ile işlemi onaylar. Bilet kullanıcının cüzdanına ve profilindeki 'Biletlerim' sekmesine aktarılır.

B. İkincil Pazar (Bilet Devri ve Yeniden Satış)

Satışa Koyma: Kullanıcı gitmekten vazgeçtiği bileti seçer ve satmak istediği fiyatı girer.

Kural Kontrolü: Sistem girilen fiyatı kontrol eder (Örn: 100 TL bilet için max 120 TL). Limit aşılıyorsa uyarı verir, uygunsa listeler.

Devir: Yeni bir alıcı bileti satın aldığında, akıllı sözleşme ödemeyi satıcıya, %5 telifi organizatöre iletir ve bilet mülkiyetini alıcının cüzdanına geçirir.

C. Etkinlik Günü (Giriş ve Doğrulama)

Dinamik Kod: Kullanıcı kapıda biletini açtığında 15-20 saniyede bir güncellenen dinamik bir QR kod görür.

Görevli Taraması: Turnikedeki görevli web tabanlı tarayıcı arayüzüyle kodu okutur.

Durum Güncellemesi: Geçerli bilette yeşil onay verir ve bilet 'kullanıldı' durumuna geçer. Aynı kod veya ekran görüntüsü ikinci kez okutulduğunda kırmızı uyarı vererek geçişi engeller.

3. Sistem ve Arka Plan Akışı (Mimarinin Çalışması)

Kullanıcı arayüzdeki butonlara bastığında arka planda gerçekleşen işlem adımları:

Aşama: Bilet Basımı
Ön Yüz (Frontend): Organizatör etkinlik detayını girer.
Arka Plan & Akıllı Sözleşme: Anchor programı bilet kaydını açar ve test cüzdanına mint eder.

Aşama: İkincil Listeleme
Ön Yüz (Frontend): Kullanıcı satış fiyatını yazar.
Arka Plan & Akıllı Sözleşme: Pazar yeri programı %20 tavan kuralını doğrular ve listelemeyi kaydeder.

Aşama: İkincil Satış
Ön Yüz (Frontend): Alıcı cüzdanıyla ödemeyi onaylar.
Arka Plan & Akıllı Sözleşme: Sözleşme parayı (%95 / %5) paylaştırır, bilet sahipliğini devreder.

Aşama: Kapı Doğrulaması
Ön Yüz (Frontend): Kullanıcı dinamik QR gösterir.
Arka Plan & Akıllı Sözleşme: Doğrulama servisi süreyi ve tek kullanımlık nonce'ı kontrol edip bileti kapatır.

4. İhtiyaç Listesi ve Ekip İş Bölümü

Hackathon teslimine kadar hazırlamamız gereken işler 3 ana başlık altında toplanmıştır:

Arayüz (Frontend): Etkinlik listeleme sayfası, cüzdan bağlama butonu, kullanıcı bilet sayfası (dinamik QR gösteren) ve görevli tarayıcı ekranı.

Akıllı Sözleşme (Program): Devnet üzerinde bilet üretme, %20 tavan fiyat ve %5 telif kontrollü ikincil satış programı, bilet durumunu güncelleyen kontrol mekanizması.

Dokümantasyon & Sunum: GitHub README dosyası, sistem akış şeması ve jüri önünde yapılacak 3 dakikalık sunum slaytı.

5. Kullanılacak Teknolojiler ve İşlevleri

Solana Devnet: Canlı para kullanmadan tüm süreci test token'ları ile güvenle deneyeceğimiz geliştirici ağı.

Phantom Wallet: Kullanıcıların siteye bağlanmasını ve bilet sahipliğini imzalamasını sağlayan cüzdan arayüzü.

Anchor Framework: Solana üzerinde akıllı sözleşme (program) geliştirirken kuralları yazmamızı sağlayan çatı.

Token-2022 (Transfer Hook Mantığı): Bilet transferi gerçekleşirken ek güvenlik ve yetki kontrollerini sağlamak için faydalanılan token standardı.

Dinamik Doğrulama (TOTP / Nonce): Girişte üretilen QR kodun kopyalanamamasını ve tek sefer geçerli olmasını sağlayan zaman tabanlı kontrol mantığı.

React / Next.js: Kullanıcının ve kapı görevlisinin etkileşime gireceği web ekranlarının tasarımı.

6. Hackathon MVP Kapsamı (Sınırlandırma)

Kısıtlı sürede dağılmamak ve jüriye çalışan bir prototip gösterebilmek için kapsamı netleştirdik:

MVP Dahilinde (Yapılacaklar): Devnet üzerinde bilet basımı, kurallı ikincil satış (tavan fiyat kontrolü ve telif kesintisi) ve telefon kamerasıyla dinamik QR okutarak biletin tek seferlik kullanıma kapatılması.

MVP Dışında (Şimdilik Yapılmayacaklar): Gerçek kredi kartı / TL ödeme altyapıları, fiziki stadyum turnike donanımları ve karmaşık bilet iade mekanizmaları.