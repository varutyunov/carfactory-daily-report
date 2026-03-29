with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

marker_start = '// ── BUILD VERSION CHECK'
marker_end = '// ── SUPABASE CONFIG'

start = html.find(marker_start)
end = html.find(marker_end)

if start != -1 and end != -1:
    html = html[:start] + html[end:]
    with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print('Removed APP_BUILD block OK')
else:
    print('Not found: start=' + str(start) + ' end=' + str(end))
