$body = @{
    query = "Tokyo to Seychelles on July 12, return July 19, as a couple, beach holiday, cheapest option, direct flights only"
    probe = "1"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://letsfg.co/api/search" -Method Post -Body $body -ContentType "application/json"
$search_id = $response.search_id
$fsw_session = $response.fsw_session

Write-Host "Search ID: $search_id"
Write-Host "FSW Session Present: $(null -ne $fsw_session)"

if ($null -ne $search_id) {
    $startTime = Get-Date
    $completed = $false
    $attempts = 0
    $maxAttempts = 9
    
    while ($attempts -lt $maxAttempts -and -not $completed) {
        $attempts++
        Start-Sleep -Seconds 10
        $pollUrl = "https://letsfg.co/api/results/$($search_id)?probe=1&_fss=$($fsw_session)"
        $pollResp = Invoke-RestMethod -Uri $pollUrl -Method Get
        
        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
        Write-Host "Attempt $attempts: Status=$($pollResp.status), Results=$($pollResp.total_results), Elapsed=$($elapsed)s, Progress=$($pollResp.progress)"
        
        if ($pollResp.status -eq "completed") {
            $completed = $true
            if ($null -ne $pollResp.results -and $pollResp.results.Count -gt 0) {
                Write-Host "Sample Offers:"
                $pollResp.results | Select-Object -First 5 | ForEach-Object {
                    Write-Host "- Airline: $($_.airline), Price: $($_.price), Stops: $($_.stops)"
                }
            } else {
                Write-Host "No offers found."
            }
        }
    }
}
